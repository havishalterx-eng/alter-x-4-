import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresEntitlementStore } from "../entitlements/entitlement-store";
import { PlatformDb } from "./platform-db";

const databaseUrl = (() => {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      "DATABASE_URL is required for the platform-api DB integration test target",
    );
  }
  return value;
})();

const input = {
  userId: "00000000-0000-7000-8000-000000000601",
  tenantId: "00000000-0000-7000-8000-000000000602",
  workspaceId: "00000000-0000-7000-8000-000000000603",
  identityRef: "auth0|rollback-test",
  email: "rollback@example.com",
  displayName: "Rollback Test",
  tenantName: "Rollback Workspace",
  identityOrgRef: "org_rollback",
};

function migrationStatements(): string[] {
  const migrationsPath = join(__dirname, "../db/migrations");
  const sql = readdirSync(migrationsPath)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(migrationsPath, file), "utf8"))
    .join("\n--> statement-breakpoint\n");

  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("PlatformDb signup atomicity", () => {
  let adminClient: pg.Client;
  let pool: pg.Pool;
  let lookupPool: pg.Pool | undefined;
  let lookupRole: string | undefined;
  let schemaName: string;

  beforeEach(async () => {
    schemaName = `signup_${randomUUID().replaceAll("-", "_")}`;
    adminClient = new pg.Client({ connectionString: databaseUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE SCHEMA "${schemaName}"`);
    await adminClient.query(`SET search_path TO "${schemaName}"`);
    for (const statement of migrationStatements()) {
      await adminClient.query(statement);
    }

    pool = new pg.Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schemaName}`,
    });
  });

  afterEach(async () => {
    await lookupPool?.end();
    await pool.end();
    await adminClient.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    if (lookupRole) {
      await adminClient.query(`DROP ROLE IF EXISTS "${lookupRole}"`);
    }
    await adminClient.end();
  });

  async function createLookupPool(): Promise<pg.Pool> {
    lookupRole = `signup_lookup_${randomUUID().replaceAll("-", "_")}`;
    const password = randomUUID();
    await adminClient.query(
      `CREATE ROLE "${lookupRole}" LOGIN PASSWORD '${password}'`,
    );
    await adminClient.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${lookupRole}"`);
    await adminClient.query(
      `GRANT SELECT ON users, tenant_members, workspace_members TO "${lookupRole}"`,
    );
    await adminClient.query(
      `GRANT EXECUTE ON FUNCTION resolve_existing_signup(text, uuid) TO "${lookupRole}"`,
    );

    const lookupUrl = new URL(databaseUrl);
    lookupUrl.username = lookupRole;
    lookupUrl.password = password;
    lookupPool = new pg.Pool({
      connectionString: lookupUrl.toString(),
      options: `-c search_path=${schemaName}`,
    });
    return lookupPool;
  }

  async function seedExistingMembership(): Promise<void> {
    await adminClient.query(
      `INSERT INTO tenants (id, name, status)
       VALUES ($1, 'Existing Tenant', 'active')`,
      [input.tenantId],
    );
    await adminClient.query(
      `INSERT INTO users (id, identity_ref, email, status)
       VALUES ($1, $2, $3, 'active')`,
      [input.userId, input.identityRef, input.email],
    );
    await adminClient.query(
      `INSERT INTO workspaces (id, tenant_id, name, status)
       VALUES ($1, $2, 'Default', 'active')`,
      [input.workspaceId, input.tenantId],
    );
    await adminClient.query(
      `INSERT INTO tenant_members (id, tenant_id, user_id, role)
       VALUES ($1, $2, $3, 'owner')`,
      [randomUUID(), input.tenantId, input.userId],
    );
    await adminClient.query(
      `INSERT INTO workspace_members
        (id, tenant_id, workspace_id, user_id, role)
       VALUES ($1, $2, $3, $4, 'admin')`,
      [randomUUID(), input.tenantId, input.workspaceId, input.userId],
    );
  }

  it("leaves no platform rows when entitlement creation fails mid-transaction", async () => {
    const persistence = new PlatformDb(pool);
    const entitlements = new PostgresEntitlementStore(pool);

    await expect(
      persistence.createSignup(input, async (client) => {
        await entitlements.create(input.tenantId, "free", client);
        throw new Error("forced failure after entitlement insert");
      }),
    ).rejects.toThrow("forced failure after entitlement insert");

    for (const table of [
      "tenants",
      "workspaces",
      "tenant_members",
      "workspace_members",
      "entitlements",
    ]) {
      const result = await adminClient.query<{ count: string }>(
        `SELECT count(*) FROM ${table}`,
      );
      expect(result.rows[0]?.count, `${table} must roll back`).toBe("0");
    }
  });

  it("resolves existing membership without tenant context under FORCE RLS", async () => {
    await seedExistingMembership();
    const restrictedPool = await createLookupPool();
    const persistence = new PlatformDb(restrictedPool);

    const directRead = await restrictedPool.query<{ count: string }>(
      "SELECT count(*) FROM tenant_members",
    );
    expect(directRead.rows[0]?.count).toBe("0");

    for (const hint of [
      "",
      "not-a-uuid",
      "00000000-0000-7000-8000-000000000699",
    ]) {
      await expect(
        persistence.findExisting(input.identityRef, hint),
      ).resolves.toMatchObject({
        userId: input.userId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
      });
    }
  });

  it("returns no signup when identity has no membership under FORCE RLS", async () => {
    await adminClient.query(
      `INSERT INTO users (id, identity_ref, email, status)
       VALUES ($1, 'auth0|no-membership', 'none@example.com', 'active')`,
      [randomUUID()],
    );
    const restrictedPool = await createLookupPool();

    await expect(
      new PlatformDb(restrictedPool).findExisting("auth0|no-membership", ""),
    ).resolves.toBeNull();
  });
});
