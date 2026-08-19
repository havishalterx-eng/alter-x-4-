import { bigint, pgTable, primaryKey, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const modelPricing = pgTable(
  "model_pricing",
  {
    provider: text("provider").notNull(),
    resource: text("resource").notNull(),
    unitCostMinor: bigint("unit_cost_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").default("INR").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.provider, table.resource] }),
      unitCostMinorCheck: check("model_pricing_unit_cost_minor_check", sql`${table.unitCostMinor} >= 0`),
    };
  }
);
