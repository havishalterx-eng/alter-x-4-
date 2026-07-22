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
    await pool.end();
    await adminClient.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminClient.end();
  });

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
});
