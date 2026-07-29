CREATE TABLE "verification_results" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "run_id" text NOT NULL,
  "node_execution_id" text,
  "gate_type" text NOT NULL,
  "verdict" text NOT NULL,
  "score" numeric,
  "threshold" numeric,
  "reviewer_model" text,
  "details" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "verification_results_gate_type_check" CHECK ("gate_type" IN ('quality', 'hallucination', 'safety', 'build', 'render', 'placeholder', 'security', 'acceptance')),
  CONSTRAINT "verification_results_verdict_check" CHECK ("verdict" IN ('pass', 'fail', 'warn')),
  CONSTRAINT "verification_results_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "verification_results_run_tenant_fk" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "runs"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "verification_results_node_execution_tenant_fk" FOREIGN KEY ("tenant_id", "node_execution_id") REFERENCES "node_executions"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER "verification_results_reject_tenant_id_change" BEFORE UPDATE ON "verification_results" FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "verification_results" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification_results" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "verification_results_tenant_context_isolation" ON "verification_results" USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_verification_results_tenant_run_created" ON "verification_results" ("tenant_id", "run_id", "created_at");
