import {
  check,
  index,
  pgTable,
  sql,
  text,
  timestamp,
  uuid,
} from "@alterx/adapters";
import { workflows } from "./workflows";

export const triggers = pgTable(
  "triggers",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id),
    name: text("name").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default("draft"),
    provider: text("provider"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "triggers_type_check",
      sql`${table.type} IN ('webhook', 'cron', 'manual')`,
    ),
    check(
      "triggers_status_check",
      sql`${table.status} IN ('draft', 'enabled', 'disabled', 'archived')`,
    ),
    index("idx_triggers_workflow").on(table.workflowId),
  ],
);
