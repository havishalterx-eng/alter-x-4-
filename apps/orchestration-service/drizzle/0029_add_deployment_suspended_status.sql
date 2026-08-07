ALTER TABLE "deployments" DROP CONSTRAINT "deployments_status_check";
--> statement-breakpoint
ALTER TABLE "deployments"
  ADD CONSTRAINT "deployments_status_check"
  CHECK ("status" IN ('pending', 'active', 'failed', 'rolled_back', 'suspended'));
