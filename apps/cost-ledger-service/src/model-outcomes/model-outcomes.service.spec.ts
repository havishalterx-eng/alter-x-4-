import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { PostgresCostStoreProvider } from "@alterx/adapters";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ModelOutcomesService, ModelOutcomesValidationError } from "./model-outcomes.service";

/**
 * Real, non-superuser scoped role -- mirrors estimation.service.spec.ts's
 * own setup exactly (same reason: a superuser bypasses RLS regardless of
 * FORCE ROW LEVEL SECURITY, so exercising this service through the raw
 * admin connection would not actually prove tenant isolation).
 */

const migrationsFolder = resolve(process.cwd(), "apps/cost-ledger-service/drizzle");

const TENANT_A_BARE = "018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const TENANT_B_BARE = "018f4d6e-2b4a-7a3e-8c1a-1234567890b1";
const TENANT_A = `ten_${TENANT_A_BARE}`;
const TENANT_B = `ten_${TENANT_B_BARE}`;
const RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890c1";
const NODE_EXECUTION_ID = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890d1";

describe.sequential("ModelOutcomesService", () => {
  let postgres: StartedPostgreSqlContainer;
  let adminStore: PostgresCostStoreProvider;
  let scopedStore: PostgresCostStoreProvider;
  let service: ModelOutcomesService;
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

    await adminStore.withTenant(TENANT_A_BARE, async (tx) => {
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
    service = new ModelOutcomesService(scopedStore);
  }, 90_000);

  afterAll(async () => {
    await scopedStore?.close();
    await adminStore.withTenant(TENANT_A_BARE, async (tx) => {
      await tx.query(`DROP OWNED BY ${role}`);
      await tx.query(`DROP ROLE IF EXISTS ${role}`);
    });
    await adminStore?.close();
    await postgres?.stop();
  }, 60_000);

  beforeEach(async () => {
    // cost_ledger_provisioner is deliberately only granted SELECT/INSERT on
    // model_outcomes (least privilege for the real app code) -- test
    // cleanup uses the admin (superuser) connection instead, same as
    // estimation.service.spec.ts's own cost_events cleanup.
    await adminStore.withTenant(TENANT_A_BARE, async (tx) => {
      await tx.query("DELETE FROM model_outcomes");
    });
  });

  it("records a real outcome and strips the ten_ prefix before it ever reaches the uuid column", async () => {
    await service.recordOutcome({
      tenant_id: TENANT_A,
      provider: "aws-bedrock",
      resource: "tokens",
      verdict: "success",
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
      recorded_at: new Date().toISOString(),
    });

    const rows = await adminStore.withTenant(TENANT_A_BARE, async (tx) => {
      const result = await tx.query<{
        tenant_id: string;
        provider: string;
        verdict: string;
        run_id: string;
      }>("SELECT tenant_id, provider, verdict, run_id FROM model_outcomes");
      return result.rows;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT_A_BARE,
      provider: "aws-bedrock",
      verdict: "success",
      run_id: RUN_ID.slice("run_".length),
    });
  });

  it("accepts an empty run_id/node_execution_id as 'not applicable', not an invalid value", async () => {
    await expect(
      service.recordOutcome({
        tenant_id: TENANT_A,
        provider: "aws-bedrock",
        resource: "tokens",
        verdict: "failure",
        run_id: "",
        node_execution_id: "",
        recorded_at: new Date().toISOString(),
      }),
    ).resolves.toEqual({ accepted: true });

    const rows = await adminStore.withTenant(TENANT_A_BARE, async (tx) => {
      const result = await tx.query<{ run_id: string | null }>(
        "SELECT run_id FROM model_outcomes",
      );
      return result.rows;
    });
    expect(rows[0]?.run_id).toBeNull();
  });

  it("rejects a tenant_id that is not ten_ prefixed", async () => {
    await expect(
      service.recordOutcome({
        tenant_id: TENANT_A_BARE,
        provider: "aws-bedrock",
        resource: "tokens",
        verdict: "success",
        run_id: "",
        node_execution_id: "",
        recorded_at: new Date().toISOString(),
      }),
    ).rejects.toThrow(ModelOutcomesValidationError);
  });

  it("rejects a verdict outside the real vocabulary", async () => {
    await expect(
      service.recordOutcome({
        tenant_id: TENANT_A,
        provider: "aws-bedrock",
        resource: "tokens",
        verdict: "timeout",
        run_id: "",
        node_execution_id: "",
        recorded_at: new Date().toISOString(),
      }),
    ).rejects.toThrow(/verdict must be one of/);
  });

  it("queryWindow returns raw, unaggregated, most-recent-first observations across tenants", async () => {
    await service.recordOutcome({
      tenant_id: TENANT_A,
      provider: "aws-bedrock",
      resource: "tokens",
      verdict: "failure",
      run_id: "",
      node_execution_id: "",
      recorded_at: "2026-08-19T10:00:00.000Z",
    });
    await service.recordOutcome({
      tenant_id: TENANT_B,
      provider: "aws-bedrock",
      resource: "tokens",
      verdict: "success",
      run_id: "",
      node_execution_id: "",
      recorded_at: "2026-08-19T11:00:00.000Z",
    });
    await service.recordOutcome({
      tenant_id: TENANT_A,
      provider: "aws-bedrock",
      resource: "tokens",
      verdict: "success",
      run_id: "",
      node_execution_id: "",
      recorded_at: "2026-08-19T12:00:00.000Z",
    });

    const observations = await service.queryWindow("aws-bedrock", "tokens", 10);

    // Cross-tenant on purpose (real model/provider health is platform-wide,
    // not per-tenant) -- all 3 rows visible despite the caller being scoped
    // to no single tenant context, and ordered newest-first for the caller
    // (Drift Detector) to compute its own windowed rate.
    expect(observations.map((observation) => observation.verdict)).toEqual([
      "success",
      "success",
      "failure",
    ]);
    // Real RFC 3339 ("...T...Z"), not Postgres's native ::text rendering --
    // the real consumer (memory-service, Python/Pydantic v2) rejects the
    // latter. See the comment at the query site in model-outcomes.service.ts.
    for (const observation of observations) {
      expect(observation.recordedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    }
  });

  it("queryWindow never leaks a different provider's observations", async () => {
    await service.recordOutcome({
      tenant_id: TENANT_A,
      provider: "openai",
      resource: "tokens",
      verdict: "failure",
      run_id: "",
      node_execution_id: "",
      recorded_at: new Date().toISOString(),
    });

    const observations = await service.queryWindow("aws-bedrock", "tokens", 10);

    expect(observations).toEqual([]);
  });
});
