CREATE TABLE "escalations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "run_id" text NOT NULL,
  "node_execution_id" text,
  "recovery_action_id" text NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "claimed_by" uuid,
  "claimed_at" timestamptz,
  "resolved_by" uuid,
  "resolved_at" timestamptz,
  "resolution_note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "escalations_status_check" CHECK ("status" IN ('open', 'claimed', 'resolved')),
  CONSTRAINT "escalations_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "escalations_run_tenant_fk" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "runs"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "escalations_node_execution_tenant_fk" FOREIGN KEY ("tenant_id", "node_execution_id") REFERENCES "node_executions"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "escalations_recovery_action_tenant_fk" FOREIGN KEY ("tenant_id", "recovery_action_id") REFERENCES "recovery_actions"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER "escalations_reject_tenant_id_change" BEFORE UPDATE ON "escalations" FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "escalations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "escalations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "escalations_tenant_context_isolation" ON "escalations" USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_escalations_tenant_status_created" ON "escalations" ("tenant_id", "status", "created_at");
