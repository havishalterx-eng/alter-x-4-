import {
  check,
  foreignKey,
  index,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uuid,
} from "@alterx/adapters";
import { nodeExecutions } from "./node_executions";
import { recoveryActions } from "./recovery_actions";
import { runs } from "./runs";

/**
 * Created when RecoveryPolicyService.recordOutcome() records a real
 * recovery_actions row as outcome='escalated' -- a recovery strategy gave
 * up and needs real human attention. Mirrors approvals' real shape
 * (claim/resolve lifecycle) but is never tied to a workflow-defined
 * HumanApproval node -- node_execution_id is nullable here (a run-level
 * recovery escalation may have no single node to point at).
 * `claimed_by`/`resolved_by` are unconstrained uuids (platform_db's users
 * table, a different service's database -- no cross-DB FK).
 */
export const escalations = pgTable(
  "escalations",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    nodeExecutionId: text("node_execution_id"),
    recoveryActionId: text("recovery_action_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"),
    claimedBy: uuid("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "escalations_status_check",
      sql`${table.status} IN ('open', 'claimed', 'resolved')`,
    ),
    unique("escalations_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      name: "escalations_run_tenant_fk",
      columns: [table.tenantId, table.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "escalations_node_execution_tenant_fk",
      columns: [table.tenantId, table.nodeExecutionId],
      foreignColumns: [nodeExecutions.tenantId, nodeExecutions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "escalations_recovery_action_tenant_fk",
      columns: [table.tenantId, table.recoveryActionId],
      foreignColumns: [recoveryActions.tenantId, recoveryActions.id],
    }).onDelete("cascade"),
    index("idx_escalations_tenant_status_created").on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
  ],
);
