CREATE TABLE "workflow_template_variable_definitions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workflow_id" text NOT NULL,
  "workflow_version_id" text NOT NULL,
  "name" text NOT NULL,
  "value_type" text NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workflow_template_variable_definitions_type_check" CHECK ("value_type" IN ('text', 'number', 'secret', 'list')),
  CONSTRAINT "workflow_template_variable_definition_version_name_unique" UNIQUE ("tenant_id", "workflow_version_id", "name"),
  CONSTRAINT "workflow_template_variable_definitions_workflow_tenant_fk" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "workflow_template_variable_definitions_version_tenant_fk" FOREIGN KEY ("tenant_id", "workflow_version_id") REFERENCES "workflow_versions"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER "workflow_template_variable_definitions_reject_tenant_id_change"
BEFORE UPDATE ON "workflow_template_variable_definitions"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "workflow_template_variable_definitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_template_variable_definitions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workflow_template_variable_definitions_tenant_context_isolation" ON "workflow_template_variable_definitions"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_workflow_template_variable_definitions_workflow" ON "workflow_template_variable_definitions" ("tenant_id", "workflow_id", "workflow_version_id");
--> statement-breakpoint
CREATE TABLE "workflow_template_variable_values" (
  "tenant_id" uuid NOT NULL,
  "workflow_id" text NOT NULL,
  "name" text NOT NULL,
  "value_json" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workflow_template_variable_values_pk" PRIMARY KEY ("tenant_id", "workflow_id", "name"),
  CONSTRAINT "workflow_template_variable_values_workflow_tenant_fk" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER "workflow_template_variable_values_reject_tenant_id_change"
BEFORE UPDATE ON "workflow_template_variable_values"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "workflow_template_variable_values" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_template_variable_values" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workflow_template_variable_values_tenant_context_isolation" ON "workflow_template_variable_values"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "clarifications" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "conversation_id" text NOT NULL,
  "question" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "assignee_user_id" uuid,
  "assigned_at" timestamptz,
  "requested_at" timestamptz DEFAULT now() NOT NULL,
  "answered_at" timestamptz,
  "expiry_at" timestamptz NOT NULL,
  CONSTRAINT "clarifications_status_check" CHECK ("status" IN ('open', 'answered', 'expired')),
  CONSTRAINT "clarifications_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "clarifications_conversation_tenant_fk" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER "clarifications_reject_tenant_id_change"
BEFORE UPDATE ON "clarifications"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "clarifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clarifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "clarifications_tenant_context_isolation" ON "clarifications"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_clarifications_tenant_status_requested" ON "clarifications" ("tenant_id", "status", "requested_at", "id");
