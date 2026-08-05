DROP INDEX IF EXISTS "idx_deployments_tenant_project_active";
--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT IF EXISTS "deployments_active_artifact_check";
--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT IF EXISTS "deployments_artifact_tenant_fk";
--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT IF EXISTS "deployments_status_check";
--> statement-breakpoint
ALTER TABLE "deployments"
  ADD CONSTRAINT "deployments_status_check"
  CHECK ("status" IN ('pending', 'active', 'failed'));
--> statement-breakpoint
ALTER TABLE "deployments" DROP COLUMN IF EXISTS "updated_at";
--> statement-breakpoint
ALTER TABLE "deployments" DROP COLUMN IF EXISTS "destination_reference";
--> statement-breakpoint
ALTER TABLE "deployments" DROP COLUMN IF EXISTS "artifact_id";
