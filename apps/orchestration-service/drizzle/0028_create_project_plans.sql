CREATE TABLE "project_plans" (
  "tenant_id" uuid NOT NULL,
  "project_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "brief" text NOT NULL,
  "task_skeleton" jsonb,
  "status" text DEFAULT 'planning' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "project_plans_pk" PRIMARY KEY ("tenant_id", "project_id"),
  CONSTRAINT "project_plans_project_tenant_fk" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "projects"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "project_plans_conversation_tenant_fk" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "project_plans_status_check" CHECK ("status" IN ('planning', 'awaiting_clarification', 'pending_review', 'approved', 'rejected', 'changes_requested', 'building', 'failed'))
);
--> statement-breakpoint
CREATE TRIGGER "project_plans_reject_tenant_id_change"
BEFORE UPDATE ON "project_plans"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "project_plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_plans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "project_plans_tenant_context_isolation" ON "project_plans"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
