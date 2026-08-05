DROP INDEX IF EXISTS "idx_runs_tenant_project";
ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "runs_project_tenant_fk";
ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "runs_parent_kind_check";
-- Rolling back this schema cannot preserve Project Mode rows because the
-- preceding schema only permits workflow parents. All run dependents use
-- ON DELETE CASCADE, so this also prevents an invalid partial rollback.
DELETE FROM "runs" WHERE "parent_kind" = 'project';
ALTER TABLE "runs" ADD CONSTRAINT "runs_parent_kind_check" CHECK ("parent_kind" IN ('workflow'));
ALTER TABLE "runs" DROP COLUMN IF EXISTS "provisioning_closed_at";
ALTER TABLE "runs" DROP COLUMN IF EXISTS "provisioning_template_id";
ALTER TABLE "runs" DROP COLUMN IF EXISTS "provisioning_cycle_id";
ALTER TABLE "runs" DROP COLUMN IF EXISTS "provisioning_session_id";
ALTER TABLE "runs" DROP COLUMN IF EXISTS "project_id";
