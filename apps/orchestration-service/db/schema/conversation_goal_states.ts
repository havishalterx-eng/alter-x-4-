import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  sql,
  text,
  timestamp,
  uuid,
} from "@alterx/adapters";
import { conversations } from "./conversations";

export const conversationGoalStates = pgTable(
  "conversation_goal_states",
  {
    tenantId: uuid("tenant_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    goalStateJson: jsonb("goal_state_json").notNull().default({}),
    status: text("status").notNull().default("planning"),
    revision: integer("revision").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.conversationId] }),
    check(
      "conversation_goal_states_status_check",
      sql`${table.status} IN ('planning', 'awaiting_clarification', 'ready', 'executing')`,
    ),
    foreignKey({
      name: "conversation_goal_states_conversation_tenant_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }),
    index("idx_conversation_goal_states_status").on(
      table.tenantId,
      table.status,
    ),
  ],
);
