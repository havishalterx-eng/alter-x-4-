import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileConfigProvider } from "../entitlements/adapters/local-file/local-file-config-provider";
import { PostgresEntitlementStore } from "../entitlements/entitlement-store";
import { InternalEntitlementProvider } from "../entitlements/internal-entitlement-provider";
import { BillingWebhookRepository } from "./billing-webhook.repository";

const databaseUrl = process.env.DATABASE_URL ?? "";
const tenantA = "00000000-0000-7000-8000-000000000001";
const tenantB = "00000000-0000-7000-8000-000000000002";

describe.skipIf(!databaseUrl)("billing webhook PostgreSQL integration", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let repository: BillingWebhookRepository;
  let schemaName: string;
  let roleName: string;

  beforeEach(async () => {
    schemaName = `billing_webhook_${randomUUID().replaceAll("-", "_")}`;
    roleName = `billing_webhook_role_${randomUUID().replaceAll("-", "_")}`;
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
    await admin.query(
      `INSERT INTO billing_profiles
         (tenant_id, id, provider_id, status, current_plan)
       VALUES ($1, $2, 'razorpay', 'active', 'plan_basic')`,
      [tenantA, randomUUID()],
    );
    await admin.query(
      `INSERT INTO entitlements
         (id, tenant_id, plan, limits, access_state, effective_from)
       VALUES ($1, $2, 'plan_basic', '{}'::jsonb, 'active', now())`,
      [randomUUID(), tenantA],
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
    repository = new BillingWebhookRepository(pool);
  });

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${roleName}"`);
      await admin.end();
    }
  });

  it("atomically closes prior entitlement and opens upgraded plan", async () => {
    const entitlements = new InternalEntitlementProvider(
      new PostgresEntitlementStore(pool),
      new LocalFileConfigProvider(),
    );
    await repository.transaction(tenantA, async (client) => {
      await repository.insertEvent(client, {
        tenantId: tenantA,
        providerId: "razorpay",
        providerEventId: "event-upgrade",
        type: "subscription.activated",
        payload: {},
      });
      await entitlements.createEntitlement(
        tenantA,
        "plan_pro",
        client,
        { accessState: "active" },
      );
      await repository.markEventProcessed(client, tenantA, "event-upgrade");
    });

    const rows = await admin.query<{
      plan: string;
      effective_to: Date | null;
    }>(
      `SELECT plan, effective_to FROM entitlements
       WHERE tenant_id = $1 ORDER BY created_at, effective_from`,
      [tenantA],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({
      plan: "plan_basic",
      effective_to: expect.any(Date),
    });
    expect(rows.rows[1]).toMatchObject({
      plan: "plan_pro",
      effective_to: null,
    });
    await expect(
      entitlements.getEffectiveEntitlement(tenantA),
    ).resolves.toMatchObject({
      plan: "plan_pro",
      accessState: "active",
      limits: { maxRunsPerDay: 2000 },
    });
  });

  it("stores no limit override for limited and suspended dunning rows", async () => {
    const config = new LocalFileConfigProvider();
    const entitlements = new InternalEntitlementProvider(
      new PostgresEntitlementStore(pool),
      config,
    );

    await entitlements.createEntitlement(tenantA, "plan_basic", undefined, {
      accessState: "limited",
    });
    let current = await admin.query<{ limits: Record<string, number> }>(
      `SELECT limits FROM entitlements
       WHERE tenant_id = $1 AND effective_to IS NULL`,
      [tenantA],
    );
    expect(current.rows[0]?.limits).toEqual({});
    await expect(
      entitlements.getEffectiveEntitlement(tenantA),
    ).resolves.toMatchObject({
      accessState: "limited",
      limits: (await config.getDunningConfig()).limitedStateLimits,
      source: "dunning",
    });

    await entitlements.createEntitlement(tenantA, "plan_basic", undefined, {
      accessState: "suspended",
    });
    current = await admin.query<{ limits: Record<string, number> }>(
      `SELECT limits FROM entitlements
       WHERE tenant_id = $1 AND effective_to IS NULL`,
      [tenantA],
    );
    expect(current.rows[0]?.limits).toEqual({});
    const suspended = await entitlements.getEffectiveEntitlement(tenantA);
    expect(suspended.accessState).toBe("suspended");
    expect(suspended.source).toBe("dunning");
    expect(Object.values(suspended.limits)).toEqual(
      expect.arrayContaining([0]),
    );
    expect(Object.values(suspended.limits).every((value) => value === 0)).toBe(
      true,
    );

    await entitlements.createEntitlement(tenantA, "plan_basic", undefined, {
      accessState: "active",
    });
    current = await admin.query<{ limits: Record<string, number> }>(
      `SELECT limits FROM entitlements
       WHERE tenant_id = $1 AND effective_to IS NULL`,
      [tenantA],
    );
    expect(current.rows[0]?.limits).toEqual({});
    await expect(
      entitlements.getEffectiveEntitlement(tenantA),
    ).resolves.toMatchObject({
      accessState: "active",
      limits: { maxRunsPerDay: 250 },
      source: "config",
    });
  });

  it("default-denies and isolates billing event, dunning, and audit rows", async () => {
    await repository.transaction(tenantA, async (client) => {
      await repository.insertEvent(client, {
        tenantId: tenantA,
        providerId: "razorpay",
        providerEventId: "event-a",
        type: "payment.failed",
        payload: {},
      });
      await repository.saveDunningState(client, tenantA, {
        state: "grace",
        currentPlan: "plan_basic",
        firstFailedAt: new Date(),
      });
      await repository.auditTransition(client, {
        tenantId: tenantA,
        providerEventId: "event-a",
        fromState: "active",
        toState: "grace",
        reason: "payment_failed",
      });
    });

    const client = await pool.connect();
    try {
      for (const table of [
        "billing_events",
        "billing_dunning_states",
        "billing_dunning_audits",
      ]) {
        await client.query("RESET app.current_tenant_id");
        expect((await client.query(`SELECT * FROM ${table}`)).rows).toHaveLength(
          0,
        );
        await client.query(`SET app.current_tenant_id = '${tenantB}'`);
        expect((await client.query(`SELECT * FROM ${table}`)).rows).toHaveLength(
          0,
        );
        await client.query(`SET app.current_tenant_id = '${tenantA}'`);
        expect((await client.query(`SELECT * FROM ${table}`)).rows).toHaveLength(
          1,
        );
      }
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
