import {
  check,
  index,
  pgTable,
  sql,
  text,
  timestamp,
  uuid,
} from "@alterx/adapters";

/**
 * Real per-model/provider outcome observation (ENGINE-FIX-15), append-only.
 * One row per real model-gateway invocation's real success/failure verdict.
 * Distinct from cost_events (which tracks billable spend, not outcome) and
 * from intelligence-service's agent-keyed performance_records -- this is
 * the model/provider-keyed dimension neither of those tables carries,
 * consumed by memory-service's Drift Detector for real model/provider drift
 * (previously agent-only). Cross-tenant aggregate reads for drift go
 * through cost_ledger_provisioner (already BYPASSRLS), matching the
 * established "cross-tenant drift discovery role" pattern
 * intelligence-service already uses for agent drift.
 */
export const modelOutcomes = pgTable(
  "model_outcomes",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    provider: text("provider").notNull(),
    resource: text("resource").notNull(),
    verdict: text("verdict").notNull(),
    runId: uuid("run_id"),
    nodeExecutionId: uuid("node_execution_id"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "model_outcomes_verdict_check",
      sql`${table.verdict} IN ('success', 'failure', 'partial', 'escalated')`,
    ),
    index("idx_model_outcomes_tenant_recorded").on(
      table.tenantId,
      table.recordedAt,
    ),
    index("idx_model_outcomes_provider_resource_recorded").on(
      table.provider,
      table.resource,
      table.recordedAt,
    ),
  ],
);
