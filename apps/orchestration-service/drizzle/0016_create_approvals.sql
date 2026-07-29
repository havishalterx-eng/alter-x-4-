CREATE TABLE "approvals" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "run_id" text NOT NULL,
  "node_execution_id" text NOT NULL,
  "requested_action" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_at" timestamptz DEFAULT now() NOT NULL,
  "decided_at" timestamptz,
  "decided_by" uuid,
  "decision_note" text,
  "expiry_at" timestamptz NOT NULL,
  CONSTRAINT "approvals_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'expired')),
  CONSTRAINT "approvals_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "approvals_run_tenant_fk" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "runs"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "approvals_node_execution_tenant_fk" FOREIGN KEY ("tenant_id", "node_execution_id") REFERENCES "node_executions"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER "approvals_reject_tenant_id_change" BEFORE UPDATE ON "approvals" FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "approvals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "approvals_tenant_context_isolation" ON "approvals" USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_approvals_tenant_status_requested" ON "approvals" ("tenant_id", "status", "requested_at");
