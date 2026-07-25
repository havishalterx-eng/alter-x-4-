CREATE TABLE "conversation_goal_states" (
  "tenant_id" uuid NOT NULL,
  "conversation_id" text NOT NULL,
  "goal_state_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'planning' NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("tenant_id", "conversation_id"),
  CONSTRAINT "conversation_goal_states_conversation_tenant_fk" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id"),
  CONSTRAINT "conversation_goal_states_status_check" CHECK ("status" IN ('planning', 'awaiting_clarification', 'ready', 'executing'))
);
--> statement-breakpoint
CREATE TRIGGER "conversation_goal_states_reject_tenant_id_change"
BEFORE UPDATE ON "conversation_goal_states"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "conversation_goal_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conversation_goal_states" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "conversation_goal_states_tenant_context_isolation" ON "conversation_goal_states"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_conversation_goal_states_status" ON "conversation_goal_states" ("tenant_id", "status");
