ALTER TABLE "workflows" DROP CONSTRAINT "workflows_status_check";
--> statement-breakpoint
ALTER TABLE "workflows"
  ADD CONSTRAINT "workflows_status_check"
  CHECK ("status" IN ('draft', 'active', 'archived', 'paused'));
