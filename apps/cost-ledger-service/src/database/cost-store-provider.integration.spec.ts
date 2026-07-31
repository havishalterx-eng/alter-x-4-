import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { PostgresCostStoreProvider } from "@alterx/adapters";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migrationsFolder = resolve(
  process.cwd(),
  "apps/cost-ledger-service/drizzle",
);

const TENANT_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const TENANT_B = "018f4d6e-2b4a-7a3e-8c1a-1234567890b1";
const WORKSPACE_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a2";
const RUN_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a3";

interface StoredCostEvent extends Record<string, unknown> {
  readonly id: string;
  readonly internal_cost_minor: string;
}

describe.sequential("cost_db migrations and RLS isolation", () => {
  let postgres: StartedPostgreSqlContainer;
  let adminStore: PostgresCostStoreProvider;
  let scopedStore: PostgresCostStoreProvider;
  const role = `cost_test_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:16.6-alpine")
      .withDatabase("cost_db")
      .withUsername("cost_admin")
      .withPassword(randomBytes(24).toString("hex"))
      .start();

    adminStore = new PostgresCostStoreProvider({
      authentication: "static",
      connectionString: postgres.getConnectionUri(),
      migrationsFolder,
    });
    await adminStore.migrate();

    await adminStore.withTenant(TENANT_A, async (tx) => {
      await tx.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
      await tx.query(`GRANT CONNECT ON DATABASE cost_db TO ${role}`);
      await tx.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await tx.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
      );
      await tx.query(`GRANT cost_ledger_provisioner TO ${role}`);
    });

    scopedStore = new PostgresCostStoreProvider({
      authentication: "static",
      connectionString: `postgresql://${role}:${password}@${postgres.getHost()}:${postgres.getPort()}/${postgres.getDatabase()}`,
      migrationsFolder,
    });
  }, 90_000);

  afterAll(async () => {
    await scopedStore?.close();
    await adminStore.withTenant(TENANT_A, async (tx) => {
      await tx.query(`DROP OWNED BY ${role}`);
      await tx.query(`DROP ROLE IF EXISTS ${role}`);
    });
    await adminStore?.close();
    await postgres?.stop();
  }, 60_000);

  beforeEach(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await adminStore.withTenant(tenantId, async (tx) => {
        await tx.query("DELETE FROM cost_events WHERE tenant_id = $1", [
          tenantId,
        ]);
      });
    }
    await adminStore.withProvisioner(async (tx) => {
      await tx.query("DELETE FROM billing_rollups");
    });
  });

  it("keeps healthCheck reporting healthy against the container", async () => {
    const health = await adminStore.healthCheck();
    expect(health.status).toBe("healthy");
  });

  it("enforces default-deny tenant isolation on cost_events", async () => {
    const eventId = randomUUID();
    await scopedStore.withTenant(TENANT_A, async (tx) => {
      await tx.query(
        `INSERT INTO cost_events (
           id, tenant_id, workspace_id, mode, run_id, source, provider,
           resource, quantity, unit, internal_cost_minor, occurred_at
         ) VALUES ($1, $2, $3, 'workflow', $4, 'model_gateway', 'bedrock/claude-sonnet-5',
           'tokens_out', 128, 'tokens', 4200, now())`,
        [eventId, TENANT_A, WORKSPACE_A, RUN_A],
      );
    });

    const asOwner = await scopedStore.withTenant(TENANT_A, async (tx) => {
      const result = await tx.query<StoredCostEvent>(
        "SELECT id, internal_cost_minor FROM cost_events WHERE id = $1",
        [eventId],
      );
      return result.rows;
    });
    expect(asOwner).toHaveLength(1);
    expect(asOwner[0]?.internal_cost_minor).toBe("4200");

    const asOtherTenant = await scopedStore.withTenant(TENANT_B, async (tx) => {
      const result = await tx.query<StoredCostEvent>(
        "SELECT id FROM cost_events WHERE id = $1",
        [eventId],
      );
      return result.rows;
    });
    expect(asOtherTenant).toHaveLength(0);
  });

  it("rejects tenant_id reassignment on an existing cost_events row", async () => {
    const eventId = randomUUID();
    await scopedStore.withTenant(TENANT_A, async (tx) => {
      await tx.query(
        `INSERT INTO cost_events (
           id, tenant_id, workspace_id, mode, source, provider, resource,
           quantity, unit, internal_cost_minor, occurred_at
         ) VALUES ($1, $2, $3, 'project', 'sandbox', 'e2b', 'vm-hours',
           1, 'seconds', 10, now())`,
        [eventId, TENANT_A, WORKSPACE_A],
      );
    });

    await expect(
      adminStore.withTenant(TENANT_A, async (tx) => {
        await tx.query(
          "UPDATE cost_events SET tenant_id = $1 WHERE id = $2",
          [TENANT_B, eventId],
        );
      }),
    ).rejects.toThrow(/tenant_id is immutable/);
  });

  it("lets the provisioner role null billing_rollups.tenant_id for right-to-delete, but blocks any other reassignment", async () => {
    const rollupId = randomUUID();
    const tenantPseudonym = `pseudo_${randomUUID()}`;

    await adminStore.withProvisioner(async (tx) => {
      await tx.query(
        `INSERT INTO billing_rollups (
           id, tenant_pseudonym, tenant_id, period_start, period_end, mode,
           internal_cost_minor, billable_minor, margin_minor, detail
         ) VALUES ($1, $2, $3, '2026-07-01', '2026-07-31', 'workflow', 1000, 1500, 500, '{}')`,
        [rollupId, tenantPseudonym, TENANT_A],
      );
    });

    await expect(
      adminStore.withProvisioner(async (tx) => {
        await tx.query(
          "UPDATE billing_rollups SET tenant_id = $1 WHERE id = $2",
          [TENANT_B, rollupId],
        );
      }),
    ).rejects.toThrow(
      /tenant_id may only be reassigned to NULL, by the right-to-delete flow/,
    );

    await adminStore.withProvisioner(async (tx) => {
      await tx.query(
        "UPDATE billing_rollups SET tenant_id = NULL WHERE id = $1",
        [rollupId],
      );
      const result = await tx.query<{ tenant_id: string | null }>(
        "SELECT tenant_id FROM billing_rollups WHERE id = $1",
        [rollupId],
      );
      expect(result.rows[0]?.tenant_id).toBeNull();
    });
  });

  it("survives rollback and a clean re-migrate", async () => {
    await adminStore.rollback();
    await expect(
      adminStore.withTenant(TENANT_A, async (tx) => {
        await tx.query("SELECT 1 FROM cost_events LIMIT 1");
      }),
    ).rejects.toThrow();

    await adminStore.migrate();
    const healthAfterRemigrate = await adminStore.healthCheck();
    expect(healthAfterRemigrate.status).toBe("healthy");
  }, 60_000);
});
