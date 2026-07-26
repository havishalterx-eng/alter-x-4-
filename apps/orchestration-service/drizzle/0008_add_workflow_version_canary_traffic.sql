ALTER TABLE "workflow_versions"
ADD COLUMN "traffic_percent" integer;
--> statement-breakpoint
ALTER TABLE "workflow_versions"
ADD CONSTRAINT "workflow_versions_canary_traffic_check"
CHECK (
  ("status" = 'canary' AND "traffic_percent" BETWEEN 1 AND 99)
  OR ("status" <> 'canary' AND "traffic_percent" IS NULL)
);
