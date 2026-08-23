import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { PostgresCostStoreProvider } from "@alterx/adapters";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CostIngestService } from "./cost-ingest.service";

const migrationsFolder = resolve(process.cwd(), "apps/cost-ledger-service/drizzle");

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const BARE_TENANT = "018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const WORKSPACE = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890a2";
const RUN = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890a3";
const NODE = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890a4";
const WORKFLOW = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890a5";
const USD_TO_INR_RATE = 83;

interface StoredCostEvent extends Record<string, unknown> {
  readonly id: string;
  readonly run_id: string;
  readonly parent_id: string;
  readonly node_execution_id: string;
  readonly source: string;
  readonly resource: string;
  readonly quantity: string;
  readonly unit: string;
  readonly internal_cost_minor: string;
  readonly currency: string;
  readonly fx_rate_used: string | null;
  readonly amount_usd: string | null;
}

function fakeRunsClient() {
  return {
    getRunWorkspace: async () => ({
      workspace_id: WORKSPACE,
      workflow_id: WORKFLOW,
    }),
    getNodeExecutionRecoveryInfo: async () => ({ is_retry: false, is_recovery: false }),
  };
}

describe.sequential("CostIngestService against a real Postgres cost_db", () => {
  let postgres: StartedPostgreSqlContainer;
  let store: PostgresCostStoreProvider;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer("postgres:16.6-alpine")
      .withDatabase("cost_db")
      .withUsername("cost_admin")
      .withPassword(randomBytes(24).toString("hex"))
      .start();

    store = new PostgresCostStoreProvider({
      authentication: "static",
      connectionString: postgres.getConnectionUri(),
      migrationsFolder,
    });
    await store.migrate();
  }, 90_000);

  afterAll(async () => {
    await store?.close();
    await postgres?.stop();
  }, 60_000);

  beforeEach(async () => {
    await store.withTenant(BARE_TENANT, async (tx) => {
      await tx.query("DELETE FROM cost_events WHERE tenant_id = $1", [BARE_TENANT]);
    });
  });

  it("inserts a real model_gateway event with correctly cast bare uuids and derived usage", async () => {
    const service = new CostIngestService(store, fakeRunsClient(), USD_TO_INR_RATE);

    await expect(
      service.ingestCostEvent({
        tenant_id: TENANT,
        cost_event_id: "cst_018f4d6e-2b4a-7a3e-8c1a-1234567890b1",
        run_id: RUN,
        node_execution_id: NODE,
        provider_reference: "aws-bedrock",
        usage_json: JSON.stringify({ input_tokens: 100, output_tokens: 50 }),
        amount_json: JSON.stringify({ usd: 0.0125, estimated: true }),
        source: "model_gateway",
        occurred_at: "2026-07-31T00:00:00.000Z",
      }),
    ).resolves.toEqual({ accepted: true });

    const rows = await store.withTenant(BARE_TENANT, async (tx) => {
      const result = await tx.query<StoredCostEvent>(
        "SELECT id, parent_id, run_id, node_execution_id, source, resource, quantity, unit, internal_cost_minor, currency, fx_rate_used, amount_usd FROM cost_events WHERE tenant_id = $1",
        [BARE_TENANT],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "018f4d6e-2b4a-7a3e-8c1a-1234567890b1",
      parent_id: "018f4d6e-2b4a-7a3e-8c1a-1234567890a5",
      run_id: "018f4d6e-2b4a-7a3e-8c1a-1234567890a3",
      node_execution_id: "018f4d6e-2b4a-7a3e-8c1a-1234567890a4",
      source: "model_gateway",
      resource: "tokens",
      quantity: "150",
      unit: "tokens",
      internal_cost_minor: "104", // round(0.0125 * 83 * 100) = 103.75 -> 104
      currency: "INR",
      // ENGINE-FIX-P3-24: real Postgres round-trip proof the new columns
      // (0005_fx_rate_and_usd_amount.sql) actually persist -- the unit
      // spec only proves the query params get built correctly, not that
      // the CHECK constraints/column types accept them.
      fx_rate_used: "83",
      amount_usd: "0.0125",
    });
  });

  it("inserts a real sandbox event", async () => {
    const service = new CostIngestService(store, fakeRunsClient(), USD_TO_INR_RATE);

    await service.ingestCostEvent({
      tenant_id: TENANT,
      cost_event_id: "cst_018f4d6e-2b4a-7a3e-8c1a-1234567890c1",
      run_id: RUN,
      node_execution_id: NODE,
      provider_reference: "sandbox-calculator",
      usage_json: JSON.stringify({
        resource_type: "sandbox.calculator.compute",
        provider: "sandbox-calculator",
        units: 1,
        outcome: "success",
      }),
      amount_json: JSON.stringify({ usd: 0, estimated: true }),
      source: "sandbox",
      occurred_at: "2026-07-31T00:00:00.000Z",
    });

    const rows = await store.withTenant(BARE_TENANT, async (tx) => {
      const result = await tx.query<StoredCostEvent>(
        "SELECT source, resource, quantity, unit, internal_cost_minor FROM cost_events WHERE tenant_id = $1",
        [BARE_TENANT],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "sandbox",
      resource: "sandbox.calculator.compute",
      quantity: "1",
      unit: "invocations",
      internal_cost_minor: "0",
    });
  });

  it("is idempotent under SQS-style at-least-once redelivery of the same cost_event_id", async () => {
    const service = new CostIngestService(store, fakeRunsClient(), USD_TO_INR_RATE);
    const request = {
      tenant_id: TENANT,
      cost_event_id: "cst_018f4d6e-2b4a-7a3e-8c1a-1234567890d1",
      run_id: RUN,
      node_execution_id: NODE,
      provider_reference: "aws-bedrock",
      usage_json: JSON.stringify({ input_tokens: 10, output_tokens: 5 }),
      amount_json: JSON.stringify({ usd: 0.001, estimated: true }),
      source: "model_gateway",
      occurred_at: "2026-07-31T00:00:00.000Z",
    };

    await expect(service.ingestCostEvent(request)).resolves.toEqual({ accepted: true });
    await expect(service.ingestCostEvent(request)).resolves.toEqual({ accepted: true });

    const rows = await store.withTenant(BARE_TENANT, async (tx) => {
      const result = await tx.query<StoredCostEvent>(
        "SELECT id FROM cost_events WHERE tenant_id = $1",
        [BARE_TENANT],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
  });
});
