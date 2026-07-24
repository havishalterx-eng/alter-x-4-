import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  hashToken,
  InMemorySessionStore,
  PgSessionStore,
} from "./session-store";

const tenantA = "00000000-0000-7000-8000-000000000001";
const tenantB = "00000000-0000-7000-8000-000000000002";
const userId = "00000000-0000-7000-8000-000000000101";

describe("InMemorySessionStore", () => {
  it("hashes tokens and enforces tenant-scoped lifecycle operations", async () => {
    const store = new InMemorySessionStore();
    const first = await store.create({
      tenantId: tenantA,
      userId,
      refreshTokenHash: "refresh-a",
      accessTokenHash: "access-a",
      deviceInfo: { browser: "test" },
      ip: "127.0.0.1",
    });
    const second = await store.create({
      tenantId: tenantB,
      userId,
      refreshTokenHash: "refresh-b",
      accessTokenHash: "access-b",
    });

    expect(hashToken("token")).toHaveLength(64);
    await expect(store.findByRefreshTokenHash(tenantA, "refresh-a")).resolves.toEqual(
      expect.objectContaining({ id: first.id, deviceInfo: { browser: "test" } }),
    );
    await expect(store.findByAccessTokenHash(tenantA, "access-a")).resolves.toEqual(
      expect.objectContaining({ id: first.id, ip: "127.0.0.1" }),
    );
    await expect(store.findByRefreshTokenHash(tenantB, "refresh-a")).resolves.toBeUndefined();
    await expect(store.findByAccessTokenHash(tenantB, "access-a")).resolves.toBeUndefined();
    await expect(
      store.rotateRefreshToken(tenantB, first.id, "refresh-a", "next", "next-access"),
    ).resolves.toBe(false);
    await expect(
      store.rotateRefreshToken(tenantA, first.id, "wrong", "next", "next-access"),
    ).resolves.toBe(false);
    await expect(
      store.rotateRefreshToken(
        tenantA,
        first.id,
        "refresh-a",
        "refresh-next",
        "access-next",
      ),
    ).resolves.toBe(true);
    await expect(store.listActive(tenantA, userId)).resolves.toHaveLength(1);

    await store.revoke(tenantB, userId, first.id);
    await expect(store.listActive(tenantA, userId)).resolves.toHaveLength(1);
    await store.revoke(tenantA, userId, first.id);
    await expect(store.listActive(tenantA, userId)).resolves.toEqual([]);
    await expect(
      store.rotateRefreshToken(
        tenantA,
        first.id,
        "refresh-next",
        "unused",
        "unused",
      ),
    ).resolves.toBe(false);
    await expect(store.findByRefreshTokenHash(tenantA, "refresh-next")).resolves.toBeUndefined();
    await expect(store.findByAccessTokenHash(tenantA, "access-next")).resolves.toBeUndefined();
    expect(second.tenantId).toBe(tenantB);
  });
});

describe("PgSessionStore", () => {
  it("sets tenant context for every query path", async () => {
    const row = sessionRow();
    const harness = pgHarness(async (sql) => {
      if (sql.includes("INSERT INTO")) return { rows: [row] };
      if (sql.includes("SET refresh_token_hash")) return { rowCount: 1 };
      if (sql.includes("refresh_token_hash = $2")) return { rows: [row] };
      if (sql.includes("access_token_hash = $2")) return { rows: [] };
      if (sql.includes("ORDER BY last_seen_at")) return { rows: [row] };
      if (sql.includes("SET revoked_at")) return { rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const store = new PgSessionStore(harness.pool);

    await expect(
      store.create({
        tenantId: tenantA,
        userId,
        refreshTokenHash: "refresh-a",
        accessTokenHash: "access-a",
        deviceInfo: { browser: "test" },
        ip: "127.0.0.1",
      }),
    ).resolves.toEqual(expect.objectContaining({ id: row.id, revokedAt: row.revoked_at }));
    await expect(store.findByRefreshTokenHash(tenantA, "refresh-a")).resolves.toEqual(
      expect.objectContaining({ id: row.id }),
    );
    await expect(store.findByAccessTokenHash(tenantA, "missing")).resolves.toBeUndefined();
    await expect(
      store.rotateRefreshToken(tenantA, row.id, "refresh-a", "next", "next-access"),
    ).resolves.toBe(true);
    await expect(store.listActive(tenantA, userId)).resolves.toHaveLength(1);
    await store.revoke(tenantA, userId, row.id);

    expect(
      harness.query.mock.calls.filter(([sql]) =>
        String(sql).includes("set_config('app.current_tenant_id'"),
      ),
    ).toHaveLength(6);
    expect(harness.release).toHaveBeenCalledTimes(6);
  });

  it("rolls back failed tenant work and rejects missing returned rows", async () => {
    const failing = pgHarness(async (sql) => {
      if (sql.includes("INSERT INTO")) throw new Error("insert failed");
      return { rows: [] };
    });
    await expect(
      new PgSessionStore(failing.pool).create({
        tenantId: tenantA,
        userId,
        refreshTokenHash: "refresh",
        accessTokenHash: "access",
      }),
    ).rejects.toThrow("insert failed");
    expect(failing.query).toHaveBeenCalledWith("ROLLBACK");
    expect(failing.release).toHaveBeenCalled();

    const missing = pgHarness(async () => ({ rows: [] }));
    await expect(
      new PgSessionStore(missing.pool).create({
        tenantId: tenantA,
        userId,
        refreshTokenHash: "refresh",
        accessTokenHash: "access",
      }),
    ).rejects.toThrow("Session row not found");
  });
});

function pgHarness(
  work: (sql: string) => Promise<Record<string, unknown>>,
): {
  pool: pg.Pool;
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return {};
    if (sql.includes("set_config('app.current_tenant_id'")) return { rows: [] };
    return work(sql);
  });
  const release = vi.fn();
  const client = { query, release };
  const pool = {
    connect: vi.fn(async () => client),
  } as unknown as pg.Pool;
  return { pool, query, release };
}

function sessionRow() {
  return {
    id: "00000000-0000-7000-8000-000000000201",
    user_id: userId,
    tenant_id: tenantA,
    device_info: { browser: "test" },
    ip: "127.0.0.1",
    created_at: new Date("2026-01-01T00:00:00Z"),
    last_seen_at: new Date("2026-01-01T00:00:00Z"),
    revoked_at: new Date("2026-01-02T00:00:00Z"),
  };
}
