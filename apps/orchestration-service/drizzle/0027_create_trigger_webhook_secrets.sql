ALTER TABLE "trigger_versions"
ALTER COLUMN "workflow_version_id" TYPE text
USING "workflow_version_id"::text;
--> statement-breakpoint
CREATE TABLE "trigger_webhook_secrets" (
  "tenant_id" uuid NOT NULL,
  "trigger_id" text NOT NULL,
  "version" integer NOT NULL,
  "secret_hash" text NOT NULL,
  "rotated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "trigger_webhook_secrets_pk" PRIMARY KEY ("tenant_id", "trigger_id", "version"),
  CONSTRAINT "trigger_webhook_secrets_hash_check" CHECK ("secret_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "trigger_webhook_secrets_trigger_tenant_fk" FOREIGN KEY ("tenant_id", "trigger_id") REFERENCES "triggers"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER "trigger_webhook_secrets_reject_tenant_id_change"
BEFORE UPDATE ON "trigger_webhook_secrets"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "trigger_webhook_secrets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trigger_webhook_secrets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "trigger_webhook_secrets_tenant_context_isolation" ON "trigger_webhook_secrets"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_trigger_webhook_secrets_trigger" ON "trigger_webhook_secrets" ("tenant_id", "trigger_id", "version");
