DROP INDEX IF EXISTS "idx_runs_tenant_deadline";

ALTER TABLE "runs" DROP COLUMN IF EXISTS "deadline_at";
