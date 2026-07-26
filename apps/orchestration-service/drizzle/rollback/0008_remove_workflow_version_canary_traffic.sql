ALTER TABLE "workflow_versions"
DROP CONSTRAINT IF EXISTS "workflow_versions_canary_traffic_check";
--> statement-breakpoint
ALTER TABLE "workflow_versions"
DROP COLUMN IF EXISTS "traffic_percent";
