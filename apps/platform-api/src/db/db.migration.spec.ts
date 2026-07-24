import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = (() => {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      "DATABASE_URL is required for the platform-api DB integration test target",
    );
  }
  return value;
})();

const tenantA = "00000000-0000-7000-8000-000000000001";
const tenantB = "00000000-0000-7000-8000-000000000002";
const userA = "00000000-0000-7000-8000-000000000011";
const userB = "00000000-0000-7000-8000-000000000012";
const workspaceA = "00000000-0000-7000-8000-000000000021";
const workspaceB = "00000000-0000-7000-8000-000000000022";

function migrationStatements(): string[] {
  const migrationsPath = join(__dirname, "migrations");
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

async function applyMigration(client: pg.Client): Promise<void> {
  for (const statement of migrationStatements()) {
    await client.query(statement);
  }
}

async function seedRows(client: pg.Client): Promise<void> {
  await client.query(
    `INSERT INTO tenants (id, name, status)
     VALUES ($1, 'Tenant A', 'active'), ($2, 'Tenant B', 'active')`,
    [tenantA, tenantB],
  );
  await client.query(
    `INSERT INTO users (id, identity_ref, email, status)
     VALUES ($1, 'auth0|a', 'a@example.com', 'active'),
            ($2, 'auth0|b', 'b@example.com', 'active')`,
    [userA, userB],
  );
  await client.query(
    `INSERT INTO workspaces (id, tenant_id, name, status)
     VALUES ($1, $2, 'Main', 'active'), ($3, $4, 'Main', 'active')`,
    [workspaceA, tenantA, workspaceB, tenantB],
  );
  await client.query(
    `INSERT INTO tenant_members (id, tenant_id, user_id, role)
     VALUES ($1, $2, $3, 'owner'), ($4, $5, $6, 'owner')`,
    [randomUUID(), tenantA, userA, randomUUID(), tenantB, userB],
  );
  await client.query(
    `INSERT INTO workspace_members (id, tenant_id, workspace_id, user_id, role)
     VALUES ($1, $2, $3, $4, 'admin'), ($5, $6, $7, $8, 'admin')`,
    [
      randomUUID(),
      tenantA,
      workspaceA,
      userA,
      randomUUID(),
      tenantB,
      workspaceB,
      userB,
    ],
  );
  await client.query(
    `INSERT INTO entitlements (id, tenant_id, plan)
     VALUES ($1, $2, 'free'), ($3, $4, 'free')`,
    [randomUUID(), tenantA, randomUUID(), tenantB],
  );
  await client.query(
    `INSERT INTO user_sessions
       (id, user_id, tenant_id, refresh_token_hash, access_token_hash)
     VALUES ($1, $2, $3, 'refresh-a', 'access-a'),
            ($4, $5, $6, 'refresh-b', 'access-b')`,
    [randomUUID(), userA, tenantA, randomUUID(), userB, tenantB],
  );
  await client.query(
    `INSERT INTO onboarding_states
       (id, tenant_id, workspace_id, steps, current_step, status)
     VALUES ($1, $2, $3, '[]'::jsonb, NULL, 'not_started'),
            ($4, $5, $6, '[]'::jsonb, NULL, 'not_started')`,
    [randomUUID(), tenantA, workspaceA, randomUUID(), tenantB, workspaceB],
  );
}

async function createRlsClient(
  adminClient: pg.Client,
  schemaName: string,
): Promise<pg.Client> {
  const roleName = `platform_rls_${schemaName}`;
  const password = randomUUID();

  await adminClient.query(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}'`);
  await adminClient.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${roleName}"`);
  await adminClient.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schemaName}" TO "${roleName}"`,
  );

  const rlsDatabaseUrl = new URL(databaseUrl);
  rlsDatabaseUrl.username = roleName;
  rlsDatabaseUrl.password = password;

  const client = new pg.Client({
    connectionString: rlsDatabaseUrl.toString(),
  });
  await client.connect();
  await client.query(`SET search_path TO "${schemaName}"`);

  return client;
}

describe("platform_db migration", () => {
  let adminClient: pg.Client;
  let schemaName: string;

  beforeEach(async () => {
    schemaName = `test_${randomUUID().replaceAll("-", "_")}`;
    adminClient = new pg.Client({ connectionString: databaseUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE SCHEMA "${schemaName}"`);
    await adminClient.query(`SET search_path TO "${schemaName}"`);
    await applyMigration(adminClient);
  });

  afterEach(async () => {
    if (adminClient) {
      await adminClient.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  it("creates identity tables with expected core columns", async () => {
    const { rows: tables } = await adminClient.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1
       ORDER BY table_name`,
      [schemaName],
    );

    expect(tables.map((row) => row.table_name)).toEqual([
      "entitlements",
      "onboarding_states",
      "tenant_members",
      "tenants",
      "user_sessions",
      "users",
      "workspace_members",
      "workspaces",
    ]);

    const { rows: columns } = await adminClient.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      [schemaName],
    );

    expect(columns).toContainEqual({
      table_name: "tenants",
      column_name: "identity_org_ref",
      data_type: "text",
    });
    expect(columns).toContainEqual({
      table_name: "onboarding_states",
      column_name: "steps",
      data_type: "jsonb",
    });
    expect(columns).toContainEqual({
      table_name: "workspaces",
      column_name: "tenant_id",
      data_type: "uuid",
    });
    expect(columns).toContainEqual({
      table_name: "entitlements",
      column_name: "limits",
      data_type: "jsonb",
    });
    expect(columns).toContainEqual({
      table_name: "tenants",
      column_name: "sso_config",
      data_type: "jsonb",
    });
    expect(columns).toContainEqual({
      table_name: "user_sessions",
      column_name: "refresh_token_hash",
      data_type: "text",
    });
  });

  it("enforces unique workspace and membership scopes", async () => {
    await seedRows(adminClient);

    const tenantBOnlyWorkspace = randomUUID();
    await adminClient.query(
      `INSERT INTO workspaces (id, tenant_id, name, status)
       VALUES ($1, $2, 'Secondary', 'active')`,
      [tenantBOnlyWorkspace, tenantB],
    );
    await expect(
      adminClient.query(
        `INSERT INTO workspaces (id, tenant_id, name, status)
         VALUES ($1, $2, 'Main', 'active')`,
        [randomUUID(), tenantA],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      adminClient.query(
        `INSERT INTO tenant_members (id, tenant_id, user_id, role)
         VALUES ($1, $2, $3, 'member')`,
        [randomUUID(), tenantA, userA],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      adminClient.query(
        `INSERT INTO workspace_members (id, tenant_id, workspace_id, user_id, role)
         VALUES ($1, $2, $3, $4, 'viewer')`,
        [randomUUID(), tenantA, workspaceA, userA],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      adminClient.query(
        `INSERT INTO onboarding_states
          (id, tenant_id, workspace_id, steps, status)
         VALUES ($1, $2, $3, '[]'::jsonb, 'not_started')`,
        [randomUUID(), tenantA, tenantBOnlyWorkspace],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("applies tenant RLS and default-denies without context", async () => {
    await seedRows(adminClient);
    const rlsClient = await createRlsClient(adminClient, schemaName);

    try {
      for (const table of [
        "workspaces",
        "tenant_members",
        "workspace_members",
        "entitlements",
        "user_sessions",
        "onboarding_states",
      ]) {
        await rlsClient.query("RESET app.current_tenant_id");
        const unset = await rlsClient.query<{ count: string }>(
          `SELECT count(*) FROM ${table}`,
        );
        expect(unset.rows[0]?.count).toBe("0");

        await rlsClient.query(`SET app.current_tenant_id = '${tenantA}'`);
        const scoped = await rlsClient.query<{ count: string }>(
          `SELECT count(*) FROM ${table}`,
        );
        expect(scoped.rows[0]?.count).toBe("1");
      }
    } finally {
      await rlsClient.end();
    }
  });

  it("can apply migration SQL more than once", async () => {
    await applyMigration(adminClient);

    const { rows } = await adminClient.query<{ count: string }>(
      `SELECT count(*) FROM information_schema.tables WHERE table_schema = $1`,
      [schemaName],
    );

    expect(rows[0]?.count).toBe("8");
  });

  it("prevents tenant_id mutation on tenant-owned rows", async () => {
    await seedRows(adminClient);

    await expect(
      adminClient.query(`UPDATE workspaces SET tenant_id = $1 WHERE id = $2`, [
        tenantB,
        workspaceA,
      ]),
    ).rejects.toThrow("tenant_id is immutable");

    await expect(
      adminClient.query(
        `UPDATE onboarding_states SET tenant_id = $1 WHERE workspace_id = $2`,
        [tenantB, workspaceA],
      ),
    ).rejects.toThrow("tenant_id is immutable");
  });
});
