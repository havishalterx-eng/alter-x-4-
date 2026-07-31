import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";

/**
 * Billing rollup (doc 04 SS6). Retention 7 years, pseudonymized after
 * right-to-delete: `tenant_id` is nulled while `tenant_pseudonym` survives
 * irreversibly (doc 04 SS1: "Pseudonymized survivors only in cost_db and
 * audit_db"). `tenant_id` is therefore nullable and mutated exactly once by
 * the deletion flow -- see `reject_billing_rollup_tenant_reassignment()` in
 * the migration, which allows only a non-null -> NULL transition and blocks
 * any other tenant reassignment.
 */
export const billingRollups = pgTable(
  "billing_rollups",
  {
    id: uuid("id").primaryKey(),
    tenantPseudonym: text("tenant_pseudonym").notNull(),
    tenantId: uuid("tenant_id"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    mode: text("mode").notNull(),
    internalCostMinor: bigint("internal_cost_minor", {
      mode: "bigint",
    }).notNull(),
    billableMinor: bigint("billable_minor", { mode: "bigint" }).notNull(),
    marginMinor: bigint("margin_minor", { mode: "bigint" }).notNull(),
    detail: jsonb("detail").notNull(),
    finalized: boolean("finalized").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "billing_rollups_mode_check",
      sql`${table.mode} IN ('workflow', 'project')`,
    ),
    check(
      "billing_rollups_period_check",
      sql`${table.periodEnd} >= ${table.periodStart}`,
    ),
    unique("billing_rollups_tenant_pseudonym_period_mode_unique").on(
      table.tenantPseudonym,
      table.periodStart,
      table.periodEnd,
      table.mode,
    ),
    index("idx_billing_rollups_tenant_period").on(
      table.tenantId,
      table.periodStart,
      table.periodEnd,
    ),
    index("idx_billing_rollups_pseudonym_period").on(
      table.tenantPseudonym,
      table.periodStart,
      table.periodEnd,
    ),
  ],
);
