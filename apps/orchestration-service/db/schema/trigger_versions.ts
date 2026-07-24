import {
  check,
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
import type { TriggerConfig } from "../../../../packages/contracts/orchestration/v1/trigger-config.schema";
import { triggers } from "./triggers";

export const triggerVersions = pgTable(
  "trigger_versions",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    triggerId: text("trigger_id")
      .notNull()
      .references(() => triggers.id),
    version: integer("version").notNull(),
    workflowVersionId: uuid("workflow_version_id"),
    config: jsonb("config").$type<TriggerConfig>().notNull(),
    status: text("status").notNull().default("active"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "trigger_versions_status_check",
      sql`${table.status} IN ('active', 'superseded', 'disabled')`,
    ),
    unique("trigger_versions_trigger_id_version_unique").on(
      table.triggerId,
      table.version,
    ),
    index("idx_trigger_versions_trigger").on(table.triggerId),
  ],
);
