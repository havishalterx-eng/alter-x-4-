import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  sql,
  text,
  timestamp,
  uuid,
} from "@alterx/adapters";

import { runs } from "./runs";

export const blackboardCheckpoints = pgTable(
  "blackboard_checkpoints",
  {
    tenantId: uuid("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    contextKey: text("context_key").notNull(),
    valueJson: jsonb("value_json").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.runId, table.contextKey] }),
    foreignKey({
      name: "blackboard_checkpoints_run_tenant_fk",
      columns: [table.tenantId, table.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }).onDelete("cascade"),
    check(
      "blackboard_checkpoints_context_key_check",
      sql`char_length(${table.contextKey}) BETWEEN 1 AND 128 AND ${table.contextKey} ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'`,
    ),
    check(
      "blackboard_checkpoints_revision_check",
      sql`${table.revision} > 0`,
    ),
  ],
);
