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

const migrationsPath = join(__dirname, "migrations");

function migrationStatements(): string[] {
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

function migrationDeclaredTableNames(): string[] {
  const tableNames = readdirSync(migrationsPath)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .flatMap((file) => {
      const sql = readFileSync(join(migrationsPath, file), "utf8");
      return [
        ...sql.matchAll(
          /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/gi,
        ),
      ].map((match) => match[1] ?? match[2] ?? "");
    })
    .filter(Boolean)
    .sort();

  expect(new Set(tableNames).size).toBe(tableNames.length);
  return tableNames;
}

describe("platform_db schema completeness", () => {
  let adminClient: pg.Client;
  let schemaName: string;

  beforeEach(async () => {
    schemaName = `schema_${randomUUID().replaceAll("-", "_")}`;
    adminClient = new pg.Client({ connectionString: databaseUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE SCHEMA "${schemaName}"`);
    await adminClient.query(`SET search_path TO "${schemaName}"`);

    for (const statement of migrationStatements()) {
      await adminClient.query(statement);
    }
  });

  afterEach(async () => {
    if (adminClient) {
      await adminClient.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  it("creates every table declared by platform migrations", async () => {
    const { rows } = await adminClient.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1
       ORDER BY table_name`,
      [schemaName],
    );

    expect(rows.map((row) => row.table_name)).toEqual(migrationDeclaredTableNames());
  });
});
