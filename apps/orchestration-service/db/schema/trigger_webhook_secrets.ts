import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  sql,
  text,
  timestamp,
  uuid,
} from "@alterx/adapters";
import { triggers } from "./triggers";

export const triggerWebhookSecrets = pgTable(
  "trigger_webhook_secrets",
  {
    tenantId: uuid("tenant_id").notNull(),
    triggerId: text("trigger_id").notNull(),
    version: integer("version").notNull(),
    secretHash: text("secret_hash").notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "trigger_webhook_secrets_pk",
      columns: [table.tenantId, table.triggerId, table.version],
    }),
    check(
      "trigger_webhook_secrets_hash_check",
      sql`${table.secretHash} ~ '^[0-9a-f]{64}$'`,
    ),
    foreignKey({
      name: "trigger_webhook_secrets_trigger_tenant_fk",
      columns: [table.tenantId, table.triggerId],
      foreignColumns: [triggers.tenantId, triggers.id],
    }).onDelete("cascade"),
    index("idx_trigger_webhook_secrets_trigger").on(
      table.tenantId,
      table.triggerId,
      table.version,
    ),
  ],
);
