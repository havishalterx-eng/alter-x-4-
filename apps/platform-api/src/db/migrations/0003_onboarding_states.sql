CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_tenant_id_id_unique"
ON "workspaces" ("tenant_id", "id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_states" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "steps" jsonb NOT NULL,
  "current_step" text,
  "status" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "onboarding_states_tenant_workspace_fk"
    FOREIGN KEY ("tenant_id", "workspace_id")
    REFERENCES "workspaces"("tenant_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_states_workspace_id_unique"
ON "onboarding_states" ("workspace_id");
--> statement-breakpoint
DROP TRIGGER IF EXISTS onboarding_states_set_updated_at ON "onboarding_states";
--> statement-breakpoint
CREATE TRIGGER onboarding_states_set_updated_at
BEFORE UPDATE ON "onboarding_states"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS onboarding_states_prevent_tenant_id_update ON "onboarding_states";
--> statement-breakpoint
CREATE TRIGGER onboarding_states_prevent_tenant_id_update
BEFORE UPDATE ON "onboarding_states"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "onboarding_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "onboarding_states" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS onboarding_states_tenant_context_isolation ON "onboarding_states";
--> statement-breakpoint
CREATE POLICY onboarding_states_tenant_context_isolation ON "onboarding_states"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "onboarding_states" TO platform_provisioner;
