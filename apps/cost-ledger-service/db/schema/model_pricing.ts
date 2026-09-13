import { numeric, pgTable, primaryKey, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const modelPricing = pgTable(
  "model_pricing",
  {
    provider: text("provider").notNull(),
    // '' is "any model from this provider" -- the only kind of row that
    // existed before 0006, and what a lookup without a model still matches.
    modelId: text("model_id").default("").notNull(),
    resource: text("resource").notNull(),
    // numeric, not bigint: a real per-token model price is a small fraction
    // of a minor unit, and bigint rounded every one of them to zero (0006).
    unitCostMinor: numeric("unit_cost_minor").notNull(),
    currency: text("currency").default("INR").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.provider, table.modelId, table.resource] }),
      unitCostMinorCheck: check("model_pricing_unit_cost_minor_check", sql`${table.unitCostMinor} >= 0`),
    };
  }
);
