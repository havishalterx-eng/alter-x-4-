import {
  check,
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
    conversationId: text("conversation_id").references(() => conversations.id),
    correlationId: text("correlation_id").notNull(),
    causationId: text("causation_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    triggerId: text("trigger_id").references(() => triggers.id),
    triggerVersion: integer("trigger_version"),
    payload: jsonb("payload").$type<CanonicalEvent["payload"]>().notNull(),
    payloadReference: text("payload_reference"),
    signatureStatus: text("signature_status").notNull(),
  },
  (table) => [
    check(
      "events_signature_status_check",
      sql`${table.signatureStatus} IN ('verified', 'failed', 'not_applicable', 'pending')`,
    ),
    uniqueIndex("idx_events_tenant_idempotency").on(
      table.tenantId,
      table.idempotencyKey,
    ),
    index("idx_events_correlation").on(table.correlationId),
    index("idx_events_conversation").on(table.conversationId),
  ],
);
