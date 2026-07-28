ALTER TABLE "runs"
DROP CONSTRAINT IF EXISTS "runs_workflow_version_tenant_fk";
--> statement-breakpoint
ALTER TABLE "runs"
DROP COLUMN IF EXISTS "workflow_version_id";
