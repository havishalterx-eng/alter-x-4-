DROP INDEX IF EXISTS "idx_recovery_actions_pending_node";
ALTER TABLE "recovery_actions" DROP CONSTRAINT IF EXISTS "recovery_actions_strategy_check";
DELETE FROM "recovery_actions" WHERE "strategy" IS NULL OR "policy_version" IS NULL;
ALTER TABLE "recovery_actions" ALTER COLUMN "strategy" SET NOT NULL;
ALTER TABLE "recovery_actions" ALTER COLUMN "policy_version" SET NOT NULL;
ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_strategy_check" CHECK ("strategy" IN ('repair', 'retry', 'backoff', 'swap_agent', 'escalate_model', 'recompile', 'replan', 'degrade', 'ask_user', 'terminate'));
