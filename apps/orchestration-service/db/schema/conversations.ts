import {
  check,
  index,
  integer,
  pgTable,
  sql,
  text,
  timestamp,
  uuid,
} from "@alterx/adapters";

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    channel: text("channel").notNull(),
    temporalWorkflowId: text("temporal_workflow_id").notNull().unique(),
    status: text("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    idleTimeoutSeconds: integer("idle_timeout_seconds").notNull().default(1800),
  },
  (table) => [
    check(
      "conversations_channel_check",
      sql`${table.channel} IN ('web', 'whatsapp', 'voice', 'api')`,
    ),
    check(
      "conversations_status_check",
      sql`${table.status} IN ('active', 'idle', 'closed', 'archived')`,
    ),
    index("idx_conversations_tenant_status").on(
      table.tenantId,
      table.status,
    ),
  ],
);
