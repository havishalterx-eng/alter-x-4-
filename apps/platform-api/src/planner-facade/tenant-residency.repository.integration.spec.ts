import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TenantDataResidencyError, TenantResidencyRepository } from "./tenant-residency.repository";

const databaseUrl = process.env.DATABASE_URL ?? "";

describe.skipIf(!databaseUrl)("TenantResidencyRepository PostgreSQL RLS", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let repository: TenantResidencyRepository;
  let schemaName: string;
  let roleName: string;

  beforeEach(async () => {
    schemaName = `tenant_residency_${randomUUID().replaceAll("-", "_")}`;
    roleName = `tenant_residency_role_${randomUUID().replaceAll("-", "_")}`;
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}"`);
    const sql = readFileSync(
      join(__dirname, "../db/migrations/0000_platform_db_identity_foundation.sql"),
      "utf8",
    );
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await admin.query(statement);
    }
    const password = randomUUID();
    await admin.query(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}'`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${roleName}"`);
    await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schemaName}" TO "${roleName}"`);
    const url = new URL(databaseUrl);
    url.username = roleName;
    url.password = password;
    url.searchParams.set("options", `-c search_path=${schemaName}`);
    pool = new pg.Pool({ connectionString: url.toString() });
    repository = new TenantResidencyRepository(pool);
  });

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${roleName}"`);
      await admin.end();
    }
  });

  async function tenant(dataResidency: unknown): Promise<string> {
    const id = randomUUID();
    await admin.query(
      "INSERT INTO tenants (id, name, status, data_residency) VALUES ($1, 'Residency Tenant', 'active', $2)",
      [id, dataResidency === null ? null : JSON.stringify(dataResidency)],
    );
    return id;
  }

  it("reads the allowed residency codes through RLS, with or without the ten_ prefix", async () => {
    const id = await tenant({ allowed: ["eu", "de"], legal_basis: "GDPR Art. 44" });

    expect(await repository.allowedDataResidency(id)).toEqual(["eu", "de"]);
    expect(await repository.allowedDataResidency(`ten_${id}`)).toEqual(["eu", "de"]);
  });

  it("treats a tenant that pins nothing as unconstrained", async () => {
    const id = await tenant(null);

    expect(await repository.allowedDataResidency(id)).toEqual([]);
  });

  it.each([
    ["a bare array", ["eu"]],
    ["an empty allowed list", { allowed: [] }],
    ["an unknown key", { allowed: ["eu"], regions: ["eu-west-1"] }],
  ])("fails closed on %s instead of planning unconstrained", async (_name, value) => {
    const id = await tenant(value);

    await expect(repository.allowedDataResidency(id)).rejects.toBeInstanceOf(TenantDataResidencyError);
  });

  it("fails closed for a tenant it cannot see", async () => {
    await expect(repository.allowedDataResidency(randomUUID())).rejects.toThrow("tenant not found");
  });
});
