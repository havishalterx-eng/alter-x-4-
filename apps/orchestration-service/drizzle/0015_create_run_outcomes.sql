CREATE TABLE "run_outcomes" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "run_id" text NOT NULL,
  "mode" text NOT NULL,
  "eligible" boolean NOT NULL,
  "verdict" text NOT NULL,
  "human_rescue" boolean NOT NULL,
  "critical_external_error" boolean NOT NULL,
  "gates_passed" integer DEFAULT 0 NOT NULL,
  "gates_failed" integer DEFAULT 0 NOT NULL,
  "recovery_count" integer DEFAULT 0 NOT NULL,
  "human_repair_after_complete" boolean,
  "decided_at" timestamptz NOT NULL,
  CONSTRAINT "run_outcomes_mode_check" CHECK ("mode" IN ('workflow', 'project')),
  CONSTRAINT "run_outcomes_verdict_check" CHECK ("verdict" IN ('completed_verified', 'rescued', 'escalated', 'failed', 'abandoned', 'degraded')),
  CONSTRAINT "run_outcomes_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "run_outcomes_tenant_run_unique" UNIQUE ("tenant_id", "run_id"),
  CONSTRAINT "run_outcomes_run_tenant_fk" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "runs"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER "run_outcomes_reject_tenant_id_change" BEFORE UPDATE ON "run_outcomes" FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "run_outcomes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "run_outcomes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "run_outcomes_tenant_context_isolation" ON "run_outcomes" USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_run_outcomes_tenant_mode_eligible_decided" ON "run_outcomes" ("tenant_id", "mode", "eligible", "decided_at");
