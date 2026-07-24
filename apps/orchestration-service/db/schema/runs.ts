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
import { conversations } from "./conversations";
import { triggers } from "./triggers";
import { workflows } from "./workflows";

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    parentKind: text("parent_kind").notNull(),
    workflowId: text("workflow_id"),
    conversationId: text("conversation_id"),
    triggerId: text("trigger_id"),
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("runs_parent_kind_check", sql`${table.parentKind} IN ('workflow')`),
    check(
      "runs_status_check",
      sql`${table.status} IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')`,
    ),
    unique("runs_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      name: "runs_workflow_tenant_fk",
      columns: [table.tenantId, table.workflowId],
      foreignColumns: [workflows.tenantId, workflows.id],
    }),
    foreignKey({
      name: "runs_conversation_tenant_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }),
    foreignKey({
      name: "runs_trigger_tenant_fk",
      columns: [table.tenantId, table.triggerId],
      foreignColumns: [triggers.tenantId, triggers.id],
    }),
    index("idx_runs_workflow").on(table.workflowId),
    index("idx_runs_conversation").on(table.conversationId),
    index("idx_runs_tenant_status").on(table.tenantId, table.status),
  ],
);
