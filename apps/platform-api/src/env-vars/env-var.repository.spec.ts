import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnvVarRepository } from "./env-var.repository";

const tenantId = "018f47a5-7b2c-7d10-8f11-123456789abc";
const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const id = "018f47a5-7b2c-7d10-8f11-123456789abd";
const row = {
  tenant_id: tenantId,
  id,
  project_id: projectId,
  environment: "production",
  key: "DATABASE_URL",
  last4: "1234",
  use_audit_ptr: null,
  created_at: new Date("2026-08-04T10:00:00.000Z"),
  updated_at: new Date("2026-08-04T10:00:00.000Z"),
};

describe("EnvVarRepository", () => {
  let query: ReturnType<typeof vi.fn>;
  let release: ReturnType<typeof vi.fn>;
  let end: ReturnType<typeof vi.fn>;
  let repository: EnvVarRepository;

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
    repository = new EnvVarRepository(pool, true);
  });

  it("runs CRUD in tenant transactions without plaintext", async () => {
    await expect(
      repository.create(
        tenantId,
        id,
        projectId,
        { environment: "production", key: "DATABASE_URL" },
        "1234",
      ),
    ).resolves.toMatchObject({ id, tenantId, projectId, last4: "1234" });
    await expect(repository.list(tenantId, projectId)).resolves.toHaveLength(1);
    await expect(repository.find(tenantId, projectId, id)).resolves.toMatchObject({
      id,
    });
    await expect(
      repository.update(
        tenantId,
        projectId,
        id,
        { environment: "staging", key: "API_KEY" },
        "4321",
      ),
    ).resolves.toMatchObject({ id });
    await expect(repository.delete(tenantId, projectId, id)).resolves.toBe(true);

    expect(JSON.stringify(query.mock.calls)).not.toContain("raw-secret");
    expect(query).toHaveBeenCalledWith(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      [tenantId],
    );
    expect(release).toHaveBeenCalledTimes(5);
  });

  it("records uses, handles missing rows, and closes owned pool", async () => {
    await expect(repository.recordUse(tenantId, id, "actor-1")).resolves.toBeTypeOf(
      "string",
    );
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("DELETE FROM")) return result([], 0);
      return result([]);
    });
    await expect(repository.find(tenantId, projectId, id)).resolves.toBeUndefined();
    await expect(
      repository.update(tenantId, projectId, id, {}),
    ).resolves.toBeUndefined();
    await expect(repository.delete(tenantId, projectId, id)).resolves.toBe(false);
    await repository.onModuleDestroy();
    expect(end).toHaveBeenCalledOnce();
  });

  it("rolls back and releases when query fails", async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT *")) throw new Error("db down");
      return result([]);
    });
    await expect(repository.list(tenantId, projectId)).rejects.toThrow("db down");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});

function result<T extends QueryResultRow>(
  rows: T[],
  rowCount = rows.length,
): QueryResult<T> {
  return { rows, rowCount, command: "", oid: 0, fields: [] };
}
