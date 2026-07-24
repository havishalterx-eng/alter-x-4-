import type { Pool, PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";
import { ProblemDetailsSchema } from "@alterx/contracts";
import { requestFingerprint } from "./fingerprint";
import {
  PgIdempotencyStore,
  type IdempotencyExecution,
} from "./idempotency-store";

const execution: IdempotencyExecution = {
  tenantId: "00000000-0000-7000-8000-000000000001",
  key: "request-1",
  fingerprint: "fingerprint-1",
  instance: "/api/v1/workflows",
};

describe("PgIdempotencyStore", () => {
  it("persists first response and replays without re-executing", async () => {
    const database = fakeDatabase();
    const store = new PgIdempotencyStore(database.pool, 60_000);
    const operation = vi.fn().mockResolvedValue({
      status: 201,
      body: { id: "workflow-1" },
    });

    await expect(store.execute(execution, operation)).resolves.toEqual({
      status: 201,
      body: { id: "workflow-1" },
      replayed: false,
    });
    await expect(store.execute(execution, operation)).resolves.toEqual({
      status: 201,
      body: { id: "workflow-1" },
      replayed: true,
    });
    expect(operation).toHaveBeenCalledOnce();
  });

  it("returns RFC 9457 422 for fingerprint conflict", async () => {
    const database = fakeDatabase();
    const store = new PgIdempotencyStore(database.pool, 60_000);
    await store.execute(execution, async () => ({
      status: 201,
      body: { id: "workflow-1" },
    }));
    const operation = vi.fn();

    const error = await store
      .execute({ ...execution, fingerprint: "different" }, operation)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 422 });
    expect(
      ProblemDetailsSchema.safeParse(
        (error as { getResponse(): unknown }).getResponse(),
      ).success,
    ).toBe(true);
    expect(operation).not.toHaveBeenCalled();
  });

  it("allows expired key reuse with a different fingerprint", async () => {
    const database = fakeDatabase();
    let now = new Date("2026-01-01T00:00:00.000Z");
    const store = new PgIdempotencyStore(
      database.pool,
      1_000,
      () => now,
    );
    await store.execute(execution, async () => ({
      status: 201,
      body: { version: 1 },
    }));

    now = new Date("2026-01-01T00:00:01.001Z");
    await expect(
      store.execute(
        { ...execution, fingerprint: "fingerprint-2" },
        async () => ({ status: 202, body: { version: 2 } }),
      ),
    ).resolves.toEqual({
      status: 202,
      body: { version: 2 },
      replayed: false,
    });
    expect(database.rows.get(rowKey(execution))).toMatchObject({
      request_fingerprint: "fingerprint-2",
      response_status: 202,
    });
  });

  it("requires a non-empty key and validates operation status", async () => {
    const store = new PgIdempotencyStore(fakeDatabase().pool, 60_000);
    await expect(
      store.execute({ ...execution, key: " " }, async () => ({
        status: 200,
        body: {},
      })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      store.execute(execution, async () => ({ status: 700, body: {} })),
    ).rejects.toThrow("invalid HTTP status");
  });

  it("rolls back failed operations so retry can execute", async () => {
    const database = fakeDatabase();
    const store = new PgIdempotencyStore(database.pool, 60_000);
    await expect(
      store.execute(execution, async () => {
        throw new Error("operation failed");
      }),
    ).rejects.toThrow("operation failed");
    await expect(
      store.execute(execution, async () => ({ status: 200, body: null })),
    ).resolves.toMatchObject({ replayed: false });
    expect(database.queries).toContain("ROLLBACK");
  });

  it("validates TTL and closes owned pool on module destroy", async () => {
    expect(
      () => new PgIdempotencyStore(fakeDatabase().pool, 0),
    ).toThrow("positive integer");
    const database = fakeDatabase();
    const store = new PgIdempotencyStore(
      database.pool,
      1,
      () => new Date(),
      true,
    );
    await store.onModuleDestroy();
    expect(database.end).toHaveBeenCalledOnce();

    await new PgIdempotencyStore(database.pool, 1).onModuleDestroy();
    expect(database.end).toHaveBeenCalledOnce();
  });
});

describe("requestFingerprint", () => {
  it("is stable across object key order and binds method and path", () => {
    const first = requestFingerprint("post", "/items", {
      z: 1,
      nested: { b: 2, a: 1 },
    });
    expect(
      requestFingerprint("POST", "/items", {
        nested: { a: 1, b: 2 },
        z: 1,
      }),
    ).toBe(first);
    expect(requestFingerprint("PATCH", "/items", { z: 1 })).not.toBe(first);
    expect(requestFingerprint("POST", "/other", { z: 1 })).not.toBe(first);
    expect(requestFingerprint("POST", "/items", [{ b: 2, a: 1 }])).toBe(
      requestFingerprint("POST", "/items", [{ a: 1, b: 2 }]),
    );
  });
});

interface FakeRow {
  request_fingerprint: string;
  response_status: number;
  response_body: unknown;
  expires_at: Date;
}

function fakeDatabase(): {
  pool: Pool;
  rows: Map<string, FakeRow>;
  queries: string[];
  end: ReturnType<typeof vi.fn>;
} {
  const rows = new Map<string, FakeRow>();
  const queries: string[] = [];
  const end = vi.fn().mockResolvedValue(undefined);
  const client = {
    query: vi.fn(
      async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
        const normalized = sql.replaceAll(/\s+/g, " ").trim();
        queries.push(normalized);
        if (normalized.startsWith("SELECT request_fingerprint")) {
          const row = rows.get(`${String(values[0])}:${String(values[1])}`);
          return result(row ? [row] : []);
        }
        if (normalized.startsWith("DELETE FROM idempotency_keys")) {
          rows.delete(`${String(values[0])}:${String(values[1])}`);
        }
        if (normalized.startsWith("INSERT INTO idempotency_keys")) {
          rows.set(`${String(values[0])}:${String(values[1])}`, {
            request_fingerprint: String(values[2]),
            response_status: Number(values[3]),
            response_body: JSON.parse(String(values[4])),
            expires_at: values[5] as Date,
          });
        }
        return result([]);
      },
    ),
    release: vi.fn(),
  } as unknown as PoolClient;
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
    end,
  } as unknown as Pool;
  return { pool, rows, queries, end };
}

function result(rows: unknown[]): QueryResult {
  return {
    rows,
    command: "",
    rowCount: rows.length,
    oid: 0,
    fields: [],
  } as QueryResult;
}

function rowKey(value: IdempotencyExecution): string {
  return `${value.tenantId}:${value.key}`;
}
