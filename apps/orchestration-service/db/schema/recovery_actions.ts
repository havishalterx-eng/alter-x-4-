import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";
import { nodeExecutions } from "./node_executions";
import { runs } from "./runs";

/**
 * One Recovery Policy Engine decision (doc 04 §3). Scoped to a run always,
 * optionally narrowed to one node_execution. Self-Healing phase (HEAL-1):
 * schema only -- no writer service yet.
 */
export const recoveryActions = pgTable(
  "recovery_actions",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    nodeExecutionId: text("node_execution_id"),
    failureClass: text("failure_class").notNull(),
    rootCauseEstimate: jsonb("root_cause_estimate"),
    // HEAL-5 creates classification-only rows. HEAL-6 fills both fields
    // atomically after applying its deterministic policy table.
    strategy: text("strategy"),
    policyVersion: text("policy_version"),
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "recovery_actions_strategy_check",
      sql`${table.strategy} IS NULL OR ${table.strategy} IN ('repair', 'retry', 'backoff', 'swap_agent', 'escalate_model', 'recompile', 'replan', 'degrade', 'ask_user', 'terminate')`,
    ),
    check(
      "recovery_actions_outcome_check",
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('resolved', 'failed', 'escalated')`,
    ),
    unique("recovery_actions_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    foreignKey({
      name: "recovery_actions_run_tenant_fk",
      columns: [table.tenantId, table.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "recovery_actions_node_execution_tenant_fk",
      columns: [table.tenantId, table.nodeExecutionId],
      foreignColumns: [nodeExecutions.tenantId, nodeExecutions.id],
    }).onDelete("cascade"),
    index("idx_recovery_actions_tenant_run_created").on(
      table.tenantId,
      table.runId,
      table.createdAt,
    ),
  ],
);
