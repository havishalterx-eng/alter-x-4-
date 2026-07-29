ALTER TABLE "node_executions" DROP CONSTRAINT "node_executions_status_check";
--> statement-breakpoint
ALTER TABLE "node_executions" ADD CONSTRAINT "node_executions_status_check"
  CHECK ("status" IN ('running', 'succeeded', 'failed', 'blocked_pending_recovery', 'skipped', 'recovered'));
