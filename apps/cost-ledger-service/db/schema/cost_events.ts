import {
  bigint,
  boolean,
  check,
  index,
  numeric,
  pgTable,
  sql,
  text,
  timestamp,
  uuid,
} from "@alterx/adapters";

/**
 * Immutable cost ledger event (doc 04 SS6). One row per billable unit
 * ingested from Model Gateway / Tool Gateway / Sandbox / storage / browser
 * automation. `parent_id` is the generic workflow-or-project id per doc 04's
 * "workflow | project" mode split -- no FK across cost_db's boundary since
 * runs/node_executions live in orchestration_db (one service per database,
 * no cross-database joins, doc 04 SS1).
 */
export const costEvents = pgTable(
  "cost_events",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    mode: text("mode").notNull(),
    parentId: uuid("parent_id"),
    runId: uuid("run_id"),
    nodeExecutionId: uuid("node_execution_id"),
    source: text("source").notNull(),
    provider: text("provider").notNull(),
    resource: text("resource").notNull(),
    quantity: numeric("quantity").notNull(),
    unit: text("unit").notNull(),
    internalCostMinor: bigint("internal_cost_minor", {
      mode: "bigint",
    }).notNull(),
    currency: text("currency").notNull().default("INR"),
    isRetry: boolean("is_retry").notNull().default(false),
    isRecovery: boolean("is_recovery").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // ENGINE-FIX-P3-24: additive, nullable -- existing rows predate this
    // column and have nothing real to backfill it with (the rate that
    // produced their internal_cost_minor was never recorded). NULL means
    // "predates this fix", not "unknown for a row inserted today".
    fxRateUsed: numeric("fx_rate_used"),
    amountUsd: numeric("amount_usd"),
  },
  (table) => [
    check(
      "cost_events_mode_check",
      sql`${table.mode} IN ('workflow', 'project')`,
    ),
    check(
      "cost_events_source_check",
      sql`${table.source} IN ('model_gateway', 'tool_gateway', 'sandbox', 'storage', 'browser')`,
    ),
    check("cost_events_quantity_check", sql`${table.quantity} >= 0`),
    check(
      "cost_events_internal_cost_minor_check",
      sql`${table.internalCostMinor} >= 0`,
    ),
    check(
      "cost_events_fx_rate_used_check",
      sql`${table.fxRateUsed} IS NULL OR ${table.fxRateUsed} > 0`,
    ),
    check(
      "cost_events_amount_usd_check",
      sql`${table.amountUsd} IS NULL OR ${table.amountUsd} >= 0`,
    ),
    index("idx_cost_events_tenant_occurred").on(
      table.tenantId,
      table.occurredAt,
    ),
    index("idx_cost_events_tenant_run").on(table.tenantId, table.runId),
    index("idx_cost_events_tenant_parent").on(
      table.tenantId,
      table.parentId,
    ),
    index("idx_cost_events_tenant_mode_source").on(
      table.tenantId,
      table.mode,
      table.source,
    ),
  ],
);
