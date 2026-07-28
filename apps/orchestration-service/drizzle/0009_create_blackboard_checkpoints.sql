CREATE TABLE "blackboard_checkpoints" (
  "tenant_id" uuid NOT NULL,
  "run_id" text NOT NULL,
  "context_key" text NOT NULL,
  "value_json" jsonb NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "blackboard_checkpoints_tenant_run_key_pk" PRIMARY KEY ("tenant_id", "run_id", "context_key"),
  CONSTRAINT "blackboard_checkpoints_run_tenant_fk" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "runs"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "blackboard_checkpoints_context_key_check" CHECK (char_length("context_key") BETWEEN 1 AND 128 AND "context_key" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  CONSTRAINT "blackboard_checkpoints_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TRIGGER "blackboard_checkpoints_reject_tenant_id_change"
BEFORE UPDATE ON "blackboard_checkpoints"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "blackboard_checkpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blackboard_checkpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "blackboard_checkpoints_tenant_context_isolation" ON "blackboard_checkpoints"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
