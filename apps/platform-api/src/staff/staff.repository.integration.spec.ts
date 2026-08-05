import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StaffRepository } from "./staff.repository";

const tenantId = "00000000-0000-7000-8000-000000000001";
const staffId = "stf_00000000-0000-7000-8000-000000000002";

describe("StaffRepository PostgreSQL integration", () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let repository: StaffRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16.6-alpine").start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await migrate(pool);
    await pool.query(
      "INSERT INTO tenants (id, name, status) VALUES ($1, 'OPS test tenant', 'active')",
      [tenantId],
    );
    await pool.query(
      "INSERT INTO staff_users (id, identity_ref, email, roles) VALUES ($1, 'auth0|ops-test', 'ops@example.com', ARRAY['staff_admin'])",
      [staffId],
    );
    repository = new StaffRepository(pool);
  }, 90_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it("persists grant, use, expiry, and append-only audit behavior", async () => {
    const grant = await repository.grant(
      "jit_active",
      staffId,
      tenantId,
      "support_case",
      "Investigate a customer support case",
      new Date(Date.now() + 60_000),
    );
    expect((await repository.active(staffId, tenantId))?.id).toBe(grant.id);

    const expiredTenantId = "00000000-0000-7000-8000-000000000003";
    await pool.query(
      "INSERT INTO tenants (id, name, status) VALUES ($1, 'Expired test tenant', 'active')",
      [expiredTenantId],
    );
    await pool.query(
      "INSERT INTO jit_grants (id, staff_user_id, tenant_id, reason_code, reason_text, granted_at, expires_at) VALUES ('jit_expired', $1, $2, 'support_case', 'Expired access test', now() - interval '2 minutes', now() - interval '1 minute')",
      [staffId, expiredTenantId],
    );
    expect(await repository.active(staffId, expiredTenantId)).toBeUndefined();

    const actions = await pool.query<{ action: string }>(
      "SELECT action FROM jit_grant_audit WHERE jit_grant_id IN ('jit_active', 'jit_expired') ORDER BY action",
    );
    expect(actions.rows.map((row) => row.action)).toEqual(["expired", "granted", "used"]);
    await expect(
      pool.query("UPDATE jit_grant_audit SET action = 'used' WHERE jit_grant_id = 'jit_active'"),
    ).rejects.toThrow("append-only");
  });

  it("returns tenant-scoped grant history with roles but never staff identifiers", async () => {
    const otherTenantId = "00000000-0000-7000-8000-000000000004";
    const otherStaffId = "stf_00000000-0000-7000-8000-000000000005";
    await pool.query(
      "INSERT INTO tenants (id, name, status) VALUES ($1, 'Other support tenant', 'active')",
      [otherTenantId],
    );
    await pool.query(
      "INSERT INTO staff_users (id, identity_ref, email, roles) VALUES ($1, 'auth0|ops-other', 'other-ops@example.com', ARRAY['staff_billing_ops'])",
      [otherStaffId],
    );
    await repository.grant(
      "jit_customer_visible",
      staffId,
      tenantId,
      "support_case",
      "Customer-visible support investigation",
      new Date(Date.now() + 120_000),
    );
    await repository.grant(
      "jit_other_tenant",
      otherStaffId,
      otherTenantId,
      "billing_case",
      "Must never leak to another tenant",
      new Date(Date.now() + 120_000),
    );

    const page = await repository.listForTenant(tenantId, { limit: 100 });
    expect(page.data.map((grant) => grant.id)).toContain("jit_customer_visible");
    expect(page.data.map((grant) => grant.id)).not.toContain("jit_other_tenant");
    const visible = page.data.find((grant) => grant.id === "jit_customer_visible")!;
    expect(visible).toMatchObject({
      reason_code: "support_case",
      reason_text: "Customer-visible support investigation",
      staff_roles: ["staff_admin"],
    });
    expect(visible).not.toHaveProperty("staff_user_id");

    const firstPage = await repository.listForTenant(tenantId, { limit: 1 });
    expect(firstPage.page).toMatchObject({ has_more: true, limit: 1 });
    expect(firstPage.page.next_cursor).toEqual(expect.any(String));
    const secondPage = await repository.listForTenant(tenantId, {
      cursor: firstPage.page.next_cursor!,
      limit: 1,
    });
    expect(secondPage.data[0]?.id).not.toBe(firstPage.data[0]?.id);

    const other = await repository.listForTenant(otherTenantId, { limit: 100 });
    expect(other.data.map((grant) => grant.id)).toEqual(["jit_other_tenant"]);

    await expect(repository.listForTenant(tenantId, { cursor: "not-a-cursor", limit: 1 }))
      .rejects.toThrow("Invalid support access cursor");
  });
});

async function migrate(pool: pg.Pool): Promise<void> {
  for (const file of ["0000_platform_db_identity_foundation.sql", "0010_staff_plane.sql"]) {
    const source = readFileSync(join(__dirname, "../db/migrations", file), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim())) {
      if (statement) {
        await pool.query(statement);
      }
    }
  }
}
