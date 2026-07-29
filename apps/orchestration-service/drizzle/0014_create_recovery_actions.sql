CREATE TABLE "recovery_actions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "run_id" text NOT NULL,
  "node_execution_id" text,
  "failure_class" text NOT NULL,
  "root_cause_estimate" jsonb,
  "strategy" text NOT NULL,
  "policy_version" text NOT NULL,
  "outcome" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_at" timestamptz,
  CONSTRAINT "recovery_actions_strategy_check" CHECK ("strategy" IN ('repair', 'retry', 'backoff', 'swap_agent', 'escalate_model', 'recompile', 'replan', 'degrade', 'ask_user', 'terminate')),
  CONSTRAINT "recovery_actions_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('resolved', 'failed', 'escalated')),
  CONSTRAINT "recovery_actions_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "recovery_actions_run_tenant_fk" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "runs"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recovery_actions_node_execution_tenant_fk" FOREIGN KEY ("tenant_id", "node_execution_id") REFERENCES "node_executions"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER "recovery_actions_reject_tenant_id_change" BEFORE UPDATE ON "recovery_actions" FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "recovery_actions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recovery_actions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "recovery_actions_tenant_context_isolation" ON "recovery_actions" USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_recovery_actions_tenant_run_created" ON "recovery_actions" ("tenant_id", "run_id", "created_at");
