CREATE TABLE "model_outcomes" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "resource" text NOT NULL,
  "verdict" text NOT NULL,
  "run_id" uuid,
  "node_execution_id" uuid,
  "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "model_outcomes_verdict_check" CHECK ("verdict" IN ('success', 'failure', 'partial', 'escalated'))
);
--> statement-breakpoint
CREATE TRIGGER "model_outcomes_reject_tenant_id_change"
BEFORE UPDATE ON "model_outcomes"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "model_outcomes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "model_outcomes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "model_outcomes_tenant_context_isolation" ON "model_outcomes"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_model_outcomes_tenant_recorded" ON "model_outcomes" ("tenant_id", "recorded_at");
--> statement-breakpoint
-- Real drift computation is intentionally cross-tenant (platform-wide model
-- health, not per-tenant), matching the established pattern
-- intelligence-service already uses for agent drift ("cross-tenant drift
-- discovery role", migration 0002). This index serves that real aggregate
-- query, run via cost_ledger_provisioner (already BYPASSRLS, no new role
-- needed).
CREATE INDEX "idx_model_outcomes_provider_resource_recorded" ON "model_outcomes" ("provider", "resource", "recorded_at");
--> statement-breakpoint
GRANT SELECT, INSERT ON "model_outcomes" TO cost_ledger_provisioner;
