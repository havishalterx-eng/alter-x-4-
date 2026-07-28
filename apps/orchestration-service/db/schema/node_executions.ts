import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";
import { runs } from "./runs";

/** Durable execution ledger. Output stays in the Blackboard/artifact path. */
export const nodeExecutions = pgTable(
  "node_executions",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    dagNodeId: text("dag_node_id").notNull(),
    nodeType: text("node_type").notNull(),
    attempt: integer("attempt").notNull().default(1),
    agentId: text("agent_id"),
    agentVersion: integer("agent_version"),
    modelAlias: text("model_alias"),
    modelResolved: text("model_resolved"),
    status: text("status").notNull(),
    inputRef: text("input_ref"),
    outputRef: text("output_ref"),
    error: jsonb("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    check("node_executions_attempt_check", sql`${table.attempt} >= 1`),
    check(
      "node_executions_status_check",
      sql`${table.status} IN ('running', 'succeeded', 'failed', 'skipped', 'recovered')`,
    ),
    check(
      "node_executions_model_alias_check",
      sql`${table.modelAlias} IS NULL OR ${table.modelAlias} IN ('FAST', 'STANDARD', 'ADVANCED', 'CEILING')`,
    ),
    unique("node_executions_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      name: "node_executions_run_tenant_fk",
      columns: [table.tenantId, table.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }).onDelete("cascade"),
    index("idx_node_executions_run_dag_node_attempt").on(
      table.runId,
      table.dagNodeId,
      table.attempt,
    ),
    index("idx_node_executions_tenant_run_started").on(
      table.tenantId,
      table.runId,
      table.startedAt,
    ),
  ],
);
