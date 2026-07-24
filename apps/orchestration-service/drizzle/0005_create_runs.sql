CREATE TABLE "runs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "parent_kind" text NOT NULL,
  "workflow_id" text REFERENCES "workflows"("id"),
  "conversation_id" text REFERENCES "conversations"("id"),
  "trigger_id" text REFERENCES "triggers"("id"),
  "status" text DEFAULT 'pending' NOT NULL,
  "started_at" timestamptz,
  "ended_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "runs_parent_kind_check" CHECK ("parent_kind" IN ('workflow')),
  CONSTRAINT "runs_status_check" CHECK ("status" IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TRIGGER "runs_reject_tenant_id_change"
BEFORE UPDATE ON "runs"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "runs_tenant_context_isolation" ON "runs"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_runs_workflow" ON "runs" ("workflow_id");
--> statement-breakpoint
CREATE INDEX "idx_runs_conversation" ON "runs" ("conversation_id");
--> statement-breakpoint
CREATE INDEX "idx_runs_tenant_status" ON "runs" ("tenant_id", "status");
