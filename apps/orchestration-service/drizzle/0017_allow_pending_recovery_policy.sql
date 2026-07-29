ALTER TABLE "recovery_actions" ALTER COLUMN "strategy" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "recovery_actions" ALTER COLUMN "policy_version" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "recovery_actions" DROP CONSTRAINT "recovery_actions_strategy_check";
--> statement-breakpoint
ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_strategy_check" CHECK ("strategy" IS NULL OR "strategy" IN ('repair', 'retry', 'backoff', 'swap_agent', 'escalate_model', 'recompile', 'replan', 'degrade', 'ask_user', 'terminate'));
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_recovery_actions_pending_node" ON "recovery_actions" ("tenant_id", "node_execution_id") WHERE "strategy" IS NULL AND "node_execution_id" IS NOT NULL;
