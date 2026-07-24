CREATE TABLE "conversations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "temporal_workflow_id" text NOT NULL UNIQUE,
  "status" text DEFAULT 'active' NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "last_activity_at" timestamptz DEFAULT now() NOT NULL,
  "closed_at" timestamptz,
  "idle_timeout_seconds" integer DEFAULT 1800 NOT NULL,
  CONSTRAINT "conversations_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "conversations_channel_check" CHECK ("channel" IN ('web', 'whatsapp', 'voice', 'api')),
  CONSTRAINT "conversations_status_check" CHECK ("status" IN ('active', 'idle', 'closed', 'archived'))
);
--> statement-breakpoint
CREATE TRIGGER "conversations_reject_tenant_id_change"
BEFORE UPDATE ON "conversations"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "conversations_tenant_context_isolation" ON "conversations"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_conversations_tenant_status" ON "conversations" ("tenant_id", "status");
