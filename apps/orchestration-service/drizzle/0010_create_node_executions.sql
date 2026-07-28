CREATE TABLE "node_executions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "run_id" text NOT NULL,
  "dag_node_id" text NOT NULL,
  "node_type" text NOT NULL,
  "attempt" integer DEFAULT 1 NOT NULL,
  "agent_id" text,
  "agent_version" integer,
  "model_alias" text,
  "model_resolved" text,
  "status" text NOT NULL,
  "input_ref" text,
  "output_ref" text,
  "error" jsonb,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "ended_at" timestamptz,
  CONSTRAINT "node_executions_attempt_check" CHECK ("attempt" >= 1),
  CONSTRAINT "node_executions_status_check" CHECK ("status" IN ('running', 'succeeded', 'failed', 'skipped', 'recovered')),
  CONSTRAINT "node_executions_model_alias_check" CHECK ("model_alias" IS NULL OR "model_alias" IN ('FAST', 'STANDARD', 'ADVANCED', 'CEILING')),
  CONSTRAINT "node_executions_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "node_executions_run_tenant_fk" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "runs"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER "node_executions_reject_tenant_id_change"
BEFORE UPDATE ON "node_executions"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "node_executions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "node_executions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "node_executions_tenant_context_isolation" ON "node_executions"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_node_executions_run_dag_node_attempt" ON "node_executions" ("run_id", "dag_node_id", "attempt");
--> statement-breakpoint
CREATE INDEX "idx_node_executions_tenant_run_started" ON "node_executions" ("tenant_id", "run_id", "started_at");
