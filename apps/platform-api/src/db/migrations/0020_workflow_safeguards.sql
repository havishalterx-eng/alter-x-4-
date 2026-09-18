-- Safeguards one workflow adds on top of its workspace's (0019). Only the
-- additions are stored: the effective set is the workspace's safeguards OR
-- these, recomputed on every plan, so a rule the workspace turns on later
-- reaches every existing workflow and a workflow can never switch one off.
--
-- Workflows live in orchestration-service, so workflow_id has no foreign key.
-- The row goes with its workspace (ON DELETE CASCADE); a workflow deleted in
-- the engine leaves a row that nothing reads.
--
-- The CHECK keeps additions exactly these three booleans, matching the API.
--
-- Rollback: DROP TABLE workflow_safeguards;
CREATE TABLE IF NOT EXISTS "workflow_safeguards" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "workspace_id" uuid NOT NULL,
  "workflow_id" text NOT NULL,
  "additions" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workflow_safeguards_pkey" PRIMARY KEY ("tenant_id", "workflow_id"),
  CONSTRAINT "workflow_safeguards_tenant_workspace_fk"
    FOREIGN KEY ("tenant_id", "workspace_id")
    REFERENCES "workspaces"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "workflow_safeguards_workflow_id_format"
    CHECK ("workflow_id" ~ '^wf_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT "workflow_safeguards_additions_shape" CHECK (
    jsonb_typeof("additions") = 'object'
    AND "additions" ?& ARRAY['customer_visible', 'contains_pii', 'approve_external_actions']
    AND "additions" - 'customer_visible' - 'contains_pii' - 'approve_external_actions' = '{}'::jsonb
    AND jsonb_typeof("additions" -> 'customer_visible') = 'boolean'
    AND jsonb_typeof("additions" -> 'contains_pii') = 'boolean'
    AND jsonb_typeof("additions" -> 'approve_external_actions') = 'boolean'
  )
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS workflow_safeguards_prevent_tenant_id_update ON "workflow_safeguards";
--> statement-breakpoint
CREATE TRIGGER workflow_safeguards_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "workflow_safeguards"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "workflow_safeguards" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_safeguards" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS workflow_safeguards_tenant_isolation ON "workflow_safeguards";
--> statement-breakpoint
CREATE POLICY workflow_safeguards_tenant_isolation ON "workflow_safeguards"
USING (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);
