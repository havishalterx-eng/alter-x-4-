import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BillingRepository } from "./billing.repository";

const databaseUrl = process.env.DATABASE_URL ?? "";
const tenantA = "00000000-0000-7000-8000-000000000001";
const tenantB = "00000000-0000-7000-8000-000000000002";

describe.skipIf(!databaseUrl)("BillingRepository PostgreSQL RLS", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let repository: BillingRepository;
  let schemaName: string;
  let roleName: string;

  beforeEach(async () => {
    schemaName = `billing_${randomUUID().replaceAll("-", "_")}`;
    roleName = `billing_role_${randomUUID().replaceAll("-", "_")}`;
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}"`);
    await applyMigrations(admin);
    await admin.query(
      `INSERT INTO tenants (id, name, status)
       VALUES ($1, 'Tenant A', 'active'), ($2, 'Tenant B', 'active')`,
      [tenantA, tenantB],
    );

    const password = randomUUID();
    await admin.query(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}'`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${roleName}"`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES
       IN SCHEMA "${schemaName}" TO "${roleName}"`,
    );
    const url = new URL(databaseUrl);
    url.username = roleName;
    url.password = password;
    url.searchParams.set("options", `-c search_path=${schemaName}`);
    pool = new pg.Pool({ connectionString: url.toString() });
    repository = new BillingRepository(pool);
  });

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${roleName}"`);
      await admin.end();
    }
  });

  it("stores references only and enforces default-deny plus tenant isolation", async () => {
    await repository.setSubscriptionReferences(tenantA, {
      providerCustomerRef: "customer_tenant_a",
      subscriptionRef: "subscription_tenant_a",
    });
    await repository.savePaymentMethod(tenantA, {
      ref: "token_tenant_a",
      type: "card",
      brand: "Visa",
      last4: "4242",
    });

    const columns = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name IN ('billing_profiles', 'billing_payment_method_refs')`,
      [schemaName],
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining([
        "card_number",
        "pan",
        "cvv",
        "provider_token",
        "api_key",
        "secret",
      ]),
    );

    const client = await pool.connect();
    try {
      await client.query("RESET app.current_tenant_id");
      expect((await client.query("SELECT * FROM billing_profiles")).rows).toHaveLength(
        0,
      );
      expect(
        (await client.query("SELECT * FROM billing_payment_method_refs")).rows,
      ).toHaveLength(0);

      await client.query(`SET app.current_tenant_id = '${tenantB}'`);
      expect((await client.query("SELECT * FROM billing_profiles")).rows).toHaveLength(
        0,
      );
      expect(
        (await client.query("SELECT * FROM billing_payment_method_refs")).rows,
      ).toHaveLength(0);

      await client.query(`SET app.current_tenant_id = '${tenantA}'`);
      expect((await client.query("SELECT * FROM billing_profiles")).rows).toHaveLength(
        1,
      );
      expect(
        (await client.query("SELECT * FROM billing_payment_method_refs")).rows,
      ).toHaveLength(1);
    } finally {
      client.release();
    }
  });
});

async function applyMigrations(client: pg.Client): Promise<void> {
  const directory = join(__dirname, "../db/migrations");
  const sql = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(directory, file), "utf8"))
    .join("\n--> statement-breakpoint\n");
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    await client.query(statement);
  }
}
