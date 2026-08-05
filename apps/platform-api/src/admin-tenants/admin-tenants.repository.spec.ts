import { describe, expect, it, vi } from "vitest";
import { AdminTenantsRepository } from "./admin-tenants.repository";

function fakeClient(queryImpl: (sql: string, values?: unknown[]) => unknown) {
  return {
    query: vi.fn(queryImpl),
    release: vi.fn(),
  };
}

function fakePool(client: ReturnType<typeof fakeClient>) {
  return {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(),
    end: vi.fn(),
  };
}

const tenantRow = {
  id: "11111111-1111-7111-8111-111111111111",
  name: "Acme",
  status: "active",
  region: "ap-south-1",
  identity_org_ref: "org-acme",
  created_at: new Date("2026-08-01T00:00:00Z"),
};

describe("AdminTenantsRepository", () => {
  it("creates a tenant inside a set_config-scoped transaction", async () => {
    const client = fakeClient((sql) => {
      if (sql.startsWith("INSERT INTO tenants")) return { rows: [tenantRow] };
      return { rows: [] };
    });
    const pool = fakePool(client);
    const repository = new AdminTenantsRepository(pool as never);

    const result = await repository.createTenant(
      tenantRow.id,
      tenantRow.name,
      tenantRow.identity_org_ref,
      tenantRow.region,
    );

    expect(result).toEqual({
      id: tenantRow.id,
      name: tenantRow.name,
      status: tenantRow.status,
      region: tenantRow.region,
      identity_org_ref: tenantRow.identity_org_ref,
      created_at: tenantRow.created_at.toISOString(),
    });
    expect(client.query).toHaveBeenCalledWith("BEGIN");
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("set_config"),
      [tenantRow.id],
    );
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and rethrows when the operation fails inside withTenant", async () => {
    const client = fakeClient((sql) => {
      if (sql.startsWith("INSERT INTO tenants")) {
        throw new Error("constraint violation");
      }
      return { rows: [] };
    });
    const pool = fakePool(client);
    const repository = new AdminTenantsRepository(pool as never);

    await expect(
      repository.createTenant(
        tenantRow.id,
        tenantRow.name,
        tenantRow.identity_org_ref,
        tenantRow.region,
      ),
    ).rejects.toThrow("constraint violation");

    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("finds a tenant and returns undefined when missing", async () => {
    const found = fakeClient((sql) =>
      sql.startsWith("SELECT") ? { rows: [tenantRow] } : { rows: [] },
    );
    const pool = fakePool(found);
    const repository = new AdminTenantsRepository(pool as never);
    expect((await repository.find(tenantRow.id))?.name).toBe("Acme");

    const notFound = fakeClient((sql) =>
      sql.startsWith("SELECT") ? { rows: [] } : { rows: [] },
    );
    const repository2 = new AdminTenantsRepository(fakePool(notFound) as never);
    expect(await repository2.find(tenantRow.id)).toBeUndefined();
  });

  it("sets status and returns undefined when the tenant is missing", async () => {
    const suspended = { ...tenantRow, status: "suspended" };
    const found = fakeClient((sql) =>
      sql.startsWith("UPDATE tenants") ? { rows: [suspended] } : { rows: [] },
    );
    const repository = new AdminTenantsRepository(fakePool(found) as never);
    expect((await repository.setStatus(tenantRow.id, "suspended"))?.status).toBe(
      "suspended",
    );

    const missing = fakeClient(() => ({ rows: [] }));
    const repository2 = new AdminTenantsRepository(fakePool(missing) as never);
    expect(await repository2.setStatus(tenantRow.id, "active")).toBeUndefined();
  });

  it("lists tenants via the direct pool query (SECURITY DEFINER function)", async () => {
    const pool = {
      connect: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [tenantRow] }),
      end: vi.fn(),
    };
    const repository = new AdminTenantsRepository(pool as never);
    const result = await repository.list();
    expect(result).toEqual([
      {
        id: tenantRow.id,
        name: tenantRow.name,
        status: tenantRow.status,
        region: tenantRow.region,
        identity_org_ref: tenantRow.identity_org_ref,
        created_at: tenantRow.created_at.toISOString(),
      },
    ]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("admin_list_tenants()"),
    );
  });

  it("records an admin action via a direct pool query", async () => {
    const pool = {
      connect: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [] }),
      end: vi.fn(),
    };
    const repository = new AdminTenantsRepository(pool as never);
    await repository.recordAction(tenantRow.id, "stf_test", "provisioned", null);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO tenant_admin_actions"),
      expect.arrayContaining([tenantRow.id, "stf_test", "provisioned", null]),
    );
  });

  it("closes the pool on module destroy only when configured to do so", async () => {
    const pool = { connect: vi.fn(), query: vi.fn(), end: vi.fn() };

    const owning = new AdminTenantsRepository(pool as never, true);
    await owning.onModuleDestroy();
    expect(pool.end).toHaveBeenCalledTimes(1);

    const nonOwning = new AdminTenantsRepository(pool as never, false);
    await nonOwning.onModuleDestroy();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
