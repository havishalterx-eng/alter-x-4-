import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresEntitlementStore } from "./entitlement-store";

function setup(dataRow: Record<string, unknown> | undefined) {
  const query = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT tenant_id") || sql.includes("RETURNING tenant_id")) {
      return { rows: dataRow ? [dataRow] : [] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return { store: new PostgresEntitlementStore(pool), query, release };
}

describe("PostgresEntitlementStore", () => {
  it("reads active entitlement inside tenant-scoped transaction", async () => {
    const { store, query, release } = setup({
      tenant_id: "tenant-1",
      plan: "free",
      limits: { maxWorkflows: 5 },
      access_state: "active",
    });

    await expect(store.findEffective("tenant-1")).resolves.toEqual({
      tenantId: "tenant-1",
      plan: "free",
      limits: { maxWorkflows: 5 },
      accessState: "active",
    });
    expect(query).toHaveBeenCalledWith(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      ["tenant-1"],
    );
    expect(query).toHaveBeenCalledWith(expect.stringContaining("tenant_id = $1"), [
      "tenant-1",
    ]);
    expect(query).toHaveBeenLastCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns null when no active row exists", async () => {
    const { store } = setup(undefined);
    await expect(store.findEffective("tenant-1")).resolves.toBeNull();
  });

  it("creates tenant-owned entitlement with generated id", async () => {
    const { store, query } = setup({
      tenant_id: "tenant-1",
      plan: "free",
      limits: {},
      access_state: "active",
    });
    await expect(store.create("tenant-1", "free")).resolves.toEqual({
      tenantId: "tenant-1",
      plan: "free",
      limits: {},
      accessState: "active",
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO entitlements"),
      [expect.any(String), "tenant-1", "free", "{}", "active"],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET effective_to"),
      ["tenant-1"],
    );
  });

  it("rolls back and releases connection on query failure", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("query failed"))
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const store = new PostgresEntitlementStore(pool);

    await expect(store.findEffective("tenant-1")).rejects.toThrow("query failed");
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
