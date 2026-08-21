import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { PostgresCostStoreProvider } from "@alterx/adapters";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EstimationService, EstimationValidationError } from "./estimation.service";

/**
 * Real bug caught in CI (Node 22, real Testcontainers): the Testcontainers
 * admin user (`cost_admin`) is a Postgres superuser -- superusers always
 * bypass RLS, `FORCE ROW LEVEL SECURITY` notwithstanding. Exercising
 * `EstimationService` through the raw admin `PostgresCostStoreProvider`
 * meant the "never leaks across tenants" test wasn't actually proving RLS
 * enforcement -- it happened to pass or fail on incidental data timing.
 * Fixed by mirroring the exact scoped-role pattern
 * `cost-store-provider.integration.spec.ts` (OUT-1) already establishes:
 * a real, non-superuser LOGIN role, granted only the same privileges a
 * real deployed app connection would have, is what every test here now
 * runs `EstimationService` against.
 */

const migrationsFolder = resolve(process.cwd(), "apps/cost-ledger-service/drizzle");

const TENANT_A = "018f4d6e-2b4a-7a3e-8c1a-1234567890a1";
const TENANT_B = "018f4d6e-2b4a-7a3e-8c1a-1234567890b1";

async function seedCostEvent(
  store: PostgresCostStoreProvider,
  tenantId: string,
  overrides: Partial<{
    source: string;
    provider: string;
    resource: string;
    quantity: number;
    internalCostMinor: number;
    isRetry: boolean;
  }> = {},
): Promise<void> {
  const {
    source = "model_gateway",
    provider = "bedrock/claude-sonnet-5",
    resource = "tokens",
    quantity = 1000,
    internalCostMinor = 500,
    isRetry = false,
  } = overrides;
  await store.withTenant(tenantId, async (tx) => {
    await tx.query(
      `INSERT INTO cost_events
        (id, tenant_id, workspace_id, mode, source, provider, resource, quantity, unit, internal_cost_minor, is_retry, occurred_at)
       VALUES (gen_random_uuid(), $1, gen_random_uuid(), 'workflow', $2, $3, $4, $5, 'tokens', $6, $7, now())`,
      [tenantId, source, provider, resource, quantity, internalCostMinor, isRetry],
    );
  });
}

async function seedModelPricing(
  store: PostgresCostStoreProvider,
  provider: string,
  resource: string,
  unitCostMinor: number,
): Promise<void> {
  await store.withProvisioner(async (tx) => {
    await tx.query(
      `INSERT INTO model_pricing (provider, resource, unit_cost_minor, currency)
       VALUES ($1, $2, $3, 'INR')`,
      [provider, resource, unitCostMinor],
    );
  });
}

describe.sequential("EstimationService", () => {
  let postgres: StartedPostgreSqlContainer;
  let adminStore: PostgresCostStoreProvider;
  let scopedStore: PostgresCostStoreProvider;
  let service: EstimationService;
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

    // Real, non-superuser role -- same shape a real deployed app connection
    // has, and the only way RLS is actually exercised (see comment above).
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
    service = new EstimationService(scopedStore);
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
        await tx.query("DELETE FROM cost_events WHERE tenant_id = $1", [tenantId]);
      });
    }
    await adminStore.withProvisioner(async (tx) => {
      await tx.query("DELETE FROM model_pricing");
    });
  });

  it("estimates from real tenant historical data when it exists", async () => {
    await seedCostEvent(adminStore, TENANT_A, { quantity: 1000, internalCostMinor: 500 });
    await seedCostEvent(adminStore, TENANT_A, { quantity: 1000, internalCostMinor: 500 });

    const result = await service.estimate({
      tenantId: TENANT_A,
      mode: "workflow",
      lineItems: [
        {
          source: "model_gateway",
          provider: "bedrock/claude-sonnet-5",
          resource: "tokens",
          expectedQuantity: 2000,
        },
      ],
    });

    const item = result.lineItems[0]!;
    expect(item.confidence).toBe("tenant_historical");
    expect(item.sampleSize).toBe(2);
    // unit cost = 500/1000 = 0.5/token, kept as the raw fraction (rounding
    // it up to 1 first was ENGINE-FIX-P3-2's bug); 2000 tokens -> real cost
    // ceil(0.5 * 2000) = 1000, not the old inflated 2000.
    expect(item.historicalUnitCostMinor).toBe("0.5");
    expect(item.estimatedBaseCostMinor).toBe("1000");
    expect(result.hasUnestimatedLineItems).toBe(false);
  });

  it("never lets tenant B's data leak into tenant A's estimate (falls back to global instead)", async () => {
    // Only tenant B has real data for this resource.
    await seedCostEvent(adminStore, TENANT_B, {
      source: "tool_gateway",
      provider: "tavily",
      resource: "search_call",
      quantity: 1,
      internalCostMinor: 300,
    });

    const result = await service.estimate({
      tenantId: TENANT_A,
      mode: "workflow",
      lineItems: [
        { source: "tool_gateway", provider: "tavily", resource: "search_call", expectedQuantity: 1 },
      ],
    });

    const item = result.lineItems[0]!;
    // Real data exists (tenant B's) so this is a *global* fallback, not "no_data" --
    // proves tenant A's own scoped query correctly saw zero of tenant B's rows.
    expect(item.confidence).toBe("global_historical");
    expect(item.sampleSize).toBe(1);
    expect(item.estimatedBaseCostMinor).toBe("300");
  });

  it("returns an honest no_data result when nothing exists anywhere, never a fabricated number", async () => {
    const result = await service.estimate({
      tenantId: TENANT_A,
      mode: "workflow",
      lineItems: [
        { source: "sandbox", provider: "e2b", resource: "vm_seconds", expectedQuantity: 60 },
      ],
    });

    const item = result.lineItems[0]!;
    expect(item.confidence).toBe("no_data");
    expect(item.sampleSize).toBe(0);
    expect(item.historicalUnitCostMinor).toBeNull();
    expect(item.estimatedTotalCostMinor).toBe("0");
    expect(result.hasUnestimatedLineItems).toBe(true);
  });

  it("inflates the estimate by the real historical retry rate", async () => {
    await seedCostEvent(adminStore, TENANT_A, {
      source: "sandbox",
      provider: "e2b",
      resource: "vm_seconds",
      quantity: 100,
      internalCostMinor: 100,
      isRetry: false,
    });
    await seedCostEvent(adminStore, TENANT_A, {
      source: "sandbox",
      provider: "e2b",
      resource: "vm_seconds",
      quantity: 100,
      internalCostMinor: 100,
      isRetry: true,
    });

    const result = await service.estimate({
      tenantId: TENANT_A,
      mode: "workflow",
      lineItems: [
        { source: "sandbox", provider: "e2b", resource: "vm_seconds", expectedQuantity: 100 },
      ],
    });

    const item = result.lineItems[0]!;
    expect(item.historicalRetryRate).toBeCloseTo(0.5, 5);
    expect(BigInt(item.estimatedRetryCostMinor)).toBeGreaterThan(0n);
    expect(BigInt(item.estimatedTotalCostMinor)).toBe(
      BigInt(item.estimatedBaseCostMinor) + BigInt(item.estimatedRetryCostMinor),
    );
  });

  it("sums multiple line items into a real total", async () => {
    await seedCostEvent(adminStore, TENANT_A, {
      source: "model_gateway",
      provider: "bedrock/claude-sonnet-5",
      resource: "tokens",
      quantity: 100,
      internalCostMinor: 100,
    });
    await seedCostEvent(adminStore, TENANT_A, {
      source: "tool_gateway",
      provider: "tavily",
      resource: "search_call",
      quantity: 1,
      internalCostMinor: 300,
    });

    const result = await service.estimate({
      tenantId: TENANT_A,
      mode: "workflow",
      lineItems: [
        { source: "model_gateway", provider: "bedrock/claude-sonnet-5", resource: "tokens", expectedQuantity: 100 },
        { source: "tool_gateway", provider: "tavily", resource: "search_call", expectedQuantity: 1 },
      ],
    });

    const sum = result.lineItems.reduce(
      (acc, item) => acc + BigInt(item.estimatedTotalCostMinor),
      0n,
    );
    expect(BigInt(result.totalEstimatedInternalCostMinor)).toBe(sum);
  });

  it("rejects an empty lineItems array", async () => {
    await expect(
      service.estimate({ tenantId: TENANT_A, mode: "workflow", lineItems: [] }),
    ).rejects.toThrow(EstimationValidationError);
  });

  it("rejects a non-positive expectedQuantity", async () => {
    await expect(
      service.estimate({
        tenantId: TENANT_A,
        mode: "workflow",
        lineItems: [
          { source: "sandbox", provider: "e2b", resource: "vm_seconds", expectedQuantity: 0 },
        ],
      }),
    ).rejects.toThrow(EstimationValidationError);
  });

  it("rejects a malformed tenantId", async () => {
    await expect(
      service.estimate({
        tenantId: "not-a-uuid",
        mode: "workflow",
        lineItems: [
          { source: "sandbox", provider: "e2b", resource: "vm_seconds", expectedQuantity: 1 },
        ],
      }),
    ).rejects.toThrow(EstimationValidationError);
  });

  describe("resolveUnitPrice", () => {
    it("resolves unit price from the fixed model_pricing table", async () => {
      await seedModelPricing(adminStore, "openai/gpt-4", "tokens", 1500);

      const response = await service.resolveUnitPrice({
        provider: "openai/gpt-4",
        resource: "tokens",
      });

      expect(response).toEqual({
        unit_cost_minor: "1500",
        currency: "INR",
        confidence: "fixed_table",
      });
    });

    it("falls back to global historical average (model_gateway) when fixed table misses", async () => {
      // No fixed price seeded, but we have global history for model_gateway
      await seedCostEvent(adminStore, TENANT_A, {
        source: "model_gateway",
        provider: "openai/gpt-4",
        resource: "tokens",
        quantity: 100,
        internalCostMinor: 1200, // 12 per token
      });

      const response = await service.resolveUnitPrice({
        provider: "openai/gpt-4",
        resource: "tokens",
      });

      expect(response).toEqual({
        unit_cost_minor: "12",
        currency: "INR",
        confidence: "global_historical",
      });
    });

    it("returns no_data when neither fixed table nor global history exists", async () => {
      const response = await service.resolveUnitPrice({
        provider: "anthropic/claude-3-opus",
        resource: "tokens",
      });

      expect(response).toEqual({
        unit_cost_minor: "0",
        currency: "INR",
        confidence: "no_data",
      });
    });

    it("requires provider and resource", async () => {
      await expect(service.resolveUnitPrice({ provider: "", resource: "tokens" }))
        .rejects.toThrow(EstimationValidationError);
      await expect(service.resolveUnitPrice({ provider: "openai", resource: "" }))
        .rejects.toThrow(EstimationValidationError);
    });
  });
});
