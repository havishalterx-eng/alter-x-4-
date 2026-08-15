DROP INDEX IF EXISTS "idx_runs_triggering_event";

ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "runs_triggering_event_tenant_fk";

ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_tenant_id_event_id_unique";

ALTER TABLE "runs" DROP COLUMN IF EXISTS "triggering_event_id";