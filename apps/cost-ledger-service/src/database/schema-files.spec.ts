import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { billingRollups } from "../../db/schema/billing_rollups";
import { costEvents } from "../../db/schema/cost_events";

const schemaRoot = resolve(process.cwd(), "apps/cost-ledger-service/db/schema");

const schemas = [
  ["cost_events.ts", "cost_events"],
  ["billing_rollups.ts", "billing_rollups"],
  ["model_pricing.ts", "model_pricing"],
  ["model_outcomes.ts", "model_outcomes"],
] as const;

function readSchema(file: (typeof schemas)[number][0]): string {
  return readFileSync(resolve(schemaRoot, file), "utf8").replaceAll("\r\n", "\n");
}

describe("cost_db Drizzle schemas", () => {
  it("loads both executable Drizzle table definitions", () => {
    for (const table of [costEvents, billingRollups]) {
      expect(table).toBeDefined();
    }
  });

  it.each(schemas)("%s defines %s", (file, table) => {
    const source = readSchema(file);

    expect(source).toContain(`pgTable(\n  "${table}"`);
  });

  it("keeps tenant ownership on cost_events, nullable on billing_rollups", () => {
    const costEventsSource = readSchema("cost_events.ts");
    const billingRollupsSource = readSchema("billing_rollups.ts");

    expect(costEventsSource).toContain('uuid("tenant_id").notNull()');
    expect(billingRollupsSource).toContain('tenantId: uuid("tenant_id"),');
    expect(billingRollupsSource).not.toContain(
      'uuid("tenant_id").notNull()',
    );
    expect(billingRollupsSource).toContain(
      'currency: text("currency").notNull().default("USD")',
    );
  });

  it("keeps required checks, uniques and indexes in schema definitions", () => {
    const allSources = schemas
      .map(([file]) => readSchema(file))
      .join("\n");

    for (const expected of [
      'check(\n      "cost_events_mode_check"',
      'check(\n      "cost_events_source_check"',
      'check(\n      "cost_events_fx_rate_used_check"',
      'check(\n      "cost_events_amount_usd_check"',
      'index("idx_cost_events_tenant_occurred")',
      'index("idx_cost_events_tenant_run")',
      'index("idx_cost_events_tenant_parent")',
      'index("idx_cost_events_tenant_mode_source")',
      'unique("billing_rollups_tenant_pseudonym_period_mode_currency_unique")',
      'index("idx_billing_rollups_tenant_period")',
      'index("idx_billing_rollups_pseudonym_period")',
      'check(\n      "billing_rollups_period_check"',
    ]) {
      expect(allSources).toContain(expected);
    }
  });
});
