CREATE TABLE "triggers" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "workflow_id" text NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "provider" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "triggers_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "triggers_workflow_tenant_fk" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id"),
  CONSTRAINT "triggers_type_check" CHECK ("type" IN ('webhook', 'cron', 'manual')),
  CONSTRAINT "triggers_status_check" CHECK ("status" IN ('draft', 'enabled', 'disabled', 'archived'))
);
--> statement-breakpoint
CREATE TRIGGER "triggers_reject_tenant_id_change"
BEFORE UPDATE ON "triggers"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "triggers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "triggers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "triggers_tenant_context_isolation" ON "triggers"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_triggers_workflow" ON "triggers" ("workflow_id");
