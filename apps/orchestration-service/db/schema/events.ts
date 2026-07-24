import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "@alterx/adapters";
import type { CanonicalEvent } from "../../../../packages/contracts/orchestration/v1/canonical-event.schema";
import { conversations } from "./conversations";
import { triggerVersions } from "./trigger_versions";
import { triggers } from "./triggers";

export const events = pgTable(
  "events",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    schemaVersion: text("schema_version").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    source: text("source").notNull(),
    sourceAccountId: text("source_account_id"),
    subjectId: text("subject_id"),
    conversationId: text("conversation_id"),
    correlationId: text("correlation_id"),
    causationId: text("causation_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    triggerId: text("trigger_id"),
    triggerVersion: integer("trigger_version"),
    payload: jsonb("payload").$type<CanonicalEvent["payload"]>(),
    payloadReference: text("payload_reference"),
    signatureStatus: text("signature_status").notNull(),
  },
  (table) => [
    check(
      "events_signature_status_check",
      sql`${table.signatureStatus} IN ('verified', 'unverified', 'failed')`,
    ),
    check(
      "events_payload_or_reference_check",
      sql`${table.payload} IS NOT NULL OR ${table.payloadReference} IS NOT NULL`,
    ),
    check(
      "events_trigger_pair_check",
      sql`(${table.triggerId} IS NULL AND ${table.triggerVersion} IS NULL) OR (${table.triggerId} IS NOT NULL AND ${table.triggerVersion} IS NOT NULL)`,
    ),
    foreignKey({
      name: "events_conversation_tenant_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }),
    foreignKey({
      name: "events_trigger_tenant_fk",
      columns: [table.tenantId, table.triggerId],
      foreignColumns: [triggers.tenantId, triggers.id],
    }),
    foreignKey({
      name: "events_trigger_version_tenant_fk",
      columns: [table.tenantId, table.triggerId, table.triggerVersion],
      foreignColumns: [
        triggerVersions.tenantId,
        triggerVersions.triggerId,
        triggerVersions.version,
      ],
    }),
    uniqueIndex("idx_events_tenant_idempotency").on(
      table.tenantId,
      table.idempotencyKey,
    ),
    index("idx_events_correlation").on(table.correlationId),
    index("idx_events_conversation").on(table.conversationId),
  ],
);
