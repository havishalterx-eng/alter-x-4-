CREATE TABLE "events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "event_type" text NOT NULL,
  "schema_version" text NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "source" text NOT NULL,
  "source_account_id" text,
  "subject_id" text,
  "conversation_id" text,
  "correlation_id" text,
  "causation_id" text,
  "idempotency_key" text NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz DEFAULT now() NOT NULL,
  "trigger_id" text,
  "trigger_version" integer,
  "payload" jsonb,
  "payload_reference" text,
  "signature_status" text NOT NULL,
  CONSTRAINT "events_conversation_tenant_fk" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id"),
  CONSTRAINT "events_trigger_tenant_fk" FOREIGN KEY ("tenant_id", "trigger_id") REFERENCES "triggers"("tenant_id", "id"),
  CONSTRAINT "events_trigger_version_tenant_fk" FOREIGN KEY ("tenant_id", "trigger_id", "trigger_version") REFERENCES "trigger_versions"("tenant_id", "trigger_id", "version"),
  CONSTRAINT "events_payload_or_reference_check" CHECK ("payload" IS NOT NULL OR "payload_reference" IS NOT NULL),
  CONSTRAINT "events_signature_status_check" CHECK ("signature_status" IN ('verified', 'unverified', 'failed'))
);
--> statement-breakpoint
CREATE TRIGGER "events_reject_tenant_id_change"
BEFORE UPDATE ON "events"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "events_tenant_context_isolation" ON "events"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_events_tenant_idempotency" ON "events" ("tenant_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "idx_events_correlation" ON "events" ("correlation_id");
--> statement-breakpoint
CREATE INDEX "idx_events_conversation" ON "events" ("conversation_id");
