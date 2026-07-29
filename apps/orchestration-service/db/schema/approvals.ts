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
 * A HumanApproval node's persisted request (doc 04 §3). Always tied to the
 * specific node_execution that raised it -- unlike verification_results/
 * recovery_actions, node_execution_id is NOT NULL here: there is no such
 * thing as a whole-run approval request, only a specific node's pause.
 * `decided_by` is an unconstrained uuid (platform_db's users table, a
 * different service's database -- no cross-DB FK, external reference only).
 */
export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    nodeExecutionId: text("node_execution_id").notNull(),
    requestedAction: jsonb("requested_action").notNull(),
    status: text("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by"),
    decisionNote: text("decision_note"),
    expiryAt: timestamp("expiry_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "approvals_status_check",
      sql`${table.status} IN ('pending', 'approved', 'rejected', 'expired')`,
    ),
    unique("approvals_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      name: "approvals_run_tenant_fk",
      columns: [table.tenantId, table.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "approvals_node_execution_tenant_fk",
      columns: [table.tenantId, table.nodeExecutionId],
      foreignColumns: [nodeExecutions.tenantId, nodeExecutions.id],
    }).onDelete("cascade"),
    index("idx_approvals_tenant_status_requested").on(
      table.tenantId,
      table.status,
      table.requestedAt,
    ),
  ],
);
