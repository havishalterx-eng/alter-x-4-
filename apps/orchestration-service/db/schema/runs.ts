import {
  check,
  index,
  pgTable,
  sql,
  text,
  timestamp,
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
    workflowId: text("workflow_id").references(() => workflows.id),
    conversationId: text("conversation_id").references(() => conversations.id),
    triggerId: text("trigger_id").references(() => triggers.id),
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
    index("idx_runs_workflow").on(table.workflowId),
    index("idx_runs_conversation").on(table.conversationId),
    index("idx_runs_tenant_status").on(table.tenantId, table.status),
  ],
);
