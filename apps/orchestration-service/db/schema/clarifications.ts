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

export const clarifications = pgTable(
  "clarifications",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    question: text("question").notNull(),
    status: text("status").notNull().default("open"),
    assigneeUserId: uuid("assignee_user_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    expiryAt: timestamp("expiry_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "clarifications_status_check",
      sql`${table.status} IN ('open', 'answered', 'expired')`,
    ),
    unique("clarifications_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      name: "clarifications_conversation_tenant_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    index("idx_clarifications_tenant_status_requested").on(
      table.tenantId,
      table.status,
      table.requestedAt,
      table.id,
    ),
  ],
);
