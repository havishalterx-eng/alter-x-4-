import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialRepository } from "./credential.repository";

const tenantId = "018f47a5-7b2c-7d10-8f11-123456789abc";
const id = "018f47a5-7b2c-7d10-8f11-123456789abd";
const row = {
  tenant_id: tenantId,
  id,
  name: "DB",
  connector: "postgres",
  scope: "deploy",
  last4: "1234",
  use_audit_ptr: null,
  created_at: new Date("2026-07-26T10:00:00.000Z"),
  updated_at: new Date("2026-07-26T10:00:00.000Z"),
};

describe("CredentialRepository", () => {
  let query: ReturnType<typeof vi.fn>;
  let release: ReturnType<typeof vi.fn>;
  let end: ReturnType<typeof vi.fn>;
  let repository: CredentialRepository;

  beforeEach(() => {
    query = vi.fn(async (sql: string) => {
      if (sql.includes("RETURNING *") || sql.includes("SELECT *")) {
        return result([row]);
      }
      if (sql.includes("DELETE FROM")) return result([], 1);
      return result([]);
    });
    release = vi.fn();
    end = vi.fn(async () => undefined);
    const client = { query, release } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      end,
    } as unknown as Pool;
    repository = new CredentialRepository(pool, true);
  });

  it("runs create/list/find/update/delete in tenant transactions without value", async () => {
    expect(
      await repository.create(
        tenantId,
        id,
        { name: "DB", connector: "postgres", scope: "deploy" },
        "1234",
      ),
    ).toMatchObject({ id, tenantId, last4: "1234" });
    await expect(repository.list(tenantId)).resolves.toHaveLength(1);
    await expect(repository.find(tenantId, id)).resolves.toMatchObject({ id });
    await expect(
      repository.update(tenantId, id, { name: "Rotated" }, "4321"),
    ).resolves.toMatchObject({ id });
    await expect(repository.delete(tenantId, id)).resolves.toBe(true);

    const transcript = JSON.stringify(query.mock.calls);
    expect(transcript).not.toContain("raw-secret");
    expect(query).toHaveBeenCalledWith(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      [tenantId],
    );
    expect(release).toHaveBeenCalledTimes(5);
  });

  it("records each use, handles missing rows, and closes owned pool", async () => {
    await expect(repository.recordUse(tenantId, id, id)).resolves.toBeTypeOf(
      "string",
    );
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("DELETE FROM")) return result([], 0);
      return result([]);
    });
    await expect(repository.find(tenantId, id)).resolves.toBeUndefined();
    await expect(repository.update(tenantId, id, {})).resolves.toBeUndefined();
    await expect(repository.delete(tenantId, id)).resolves.toBe(false);
    await repository.onModuleDestroy();
    expect(end).toHaveBeenCalledOnce();
  });

  it("rolls back and releases when a query fails", async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT *")) throw new Error("db down");
      return result([]);
    });
    await expect(repository.list(tenantId)).rejects.toThrow("db down");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});

function result<T extends QueryResultRow>(
  rows: T[],
  rowCount = rows.length,
): QueryResult<T> {
  return {
    rows,
    rowCount,
    command: "",
    oid: 0,
    fields: [],
  };
}
