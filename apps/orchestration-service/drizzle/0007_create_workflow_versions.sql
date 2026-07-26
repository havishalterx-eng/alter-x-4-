CREATE TABLE "workflow_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workflow_id" text NOT NULL,
  "version" integer NOT NULL,
  "compiled_dag" jsonb NOT NULL,
  "dag_schema_version" text NOT NULL,
  "node_requirements" jsonb,
  "policy_bindings" jsonb,
  "compile_metadata" jsonb,
  "status" text DEFAULT 'compiled' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workflow_versions_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "workflow_versions_tenant_workflow_version_unique" UNIQUE ("tenant_id", "workflow_id", "version"),
  CONSTRAINT "workflow_versions_workflow_tenant_fk" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id"),
  CONSTRAINT "workflow_versions_status_check" CHECK ("status" IN ('compiled', 'canary', 'promoted', 'rolled_back', 'retired'))
);
--> statement-breakpoint
CREATE TRIGGER "workflow_versions_reject_tenant_id_change"
BEFORE UPDATE ON "workflow_versions"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "workflow_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workflow_versions_tenant_context_isolation" ON "workflow_versions"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_workflow_versions_workflow" ON "workflow_versions" ("workflow_id");
