CREATE TABLE "trigger_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "trigger_id" text NOT NULL,
  "version" integer NOT NULL,
  "workflow_version_id" uuid,
  "config" jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "activated_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "trigger_versions_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "trigger_versions_tenant_trigger_version_unique" UNIQUE ("tenant_id", "trigger_id", "version"),
  CONSTRAINT "trigger_versions_trigger_tenant_fk" FOREIGN KEY ("tenant_id", "trigger_id") REFERENCES "triggers"("tenant_id", "id"),
  CONSTRAINT "trigger_versions_status_check" CHECK ("status" IN ('active', 'superseded', 'disabled')),
  CONSTRAINT "trigger_versions_trigger_id_version_unique" UNIQUE ("trigger_id", "version")
);
--> statement-breakpoint
CREATE TRIGGER "trigger_versions_reject_tenant_id_change"
BEFORE UPDATE ON "trigger_versions"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "trigger_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trigger_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "trigger_versions_tenant_context_isolation" ON "trigger_versions"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_trigger_versions_trigger" ON "trigger_versions" ("trigger_id");
