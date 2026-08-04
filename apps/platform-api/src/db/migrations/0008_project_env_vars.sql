CREATE TABLE IF NOT EXISTS "env_vars" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "id" uuid PRIMARY KEY,
  "project_id" text NOT NULL,
  "environment" text NOT NULL,
  "key" text NOT NULL,
  "last4" text NOT NULL CHECK (char_length("last4") <= 4),
  "use_audit_ptr" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "env_vars_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "env_vars_tenant_project_environment_key_unique"
    UNIQUE ("tenant_id", "project_id", "environment", "key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "env_vars_tenant_project_created_at_idx"
ON "env_vars" ("tenant_id", "project_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "env_var_use_audits" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "id" uuid PRIMARY KEY,
  "env_var_id" uuid NOT NULL,
  "used_by" text NOT NULL,
  "used_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "env_var_use_audits_tenant_env_var_fk"
    FOREIGN KEY ("tenant_id", "env_var_id")
    REFERENCES "env_vars"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "env_var_use_audits_tenant_env_var_idx"
ON "env_var_use_audits" ("tenant_id", "env_var_id");
--> statement-breakpoint
DROP TRIGGER IF EXISTS env_vars_prevent_tenant_id_update ON "env_vars";
--> statement-breakpoint
CREATE TRIGGER env_vars_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "env_vars"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS env_var_use_audits_prevent_tenant_id_update ON "env_var_use_audits";
--> statement-breakpoint
CREATE TRIGGER env_var_use_audits_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "env_var_use_audits"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "env_vars" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "env_vars" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "env_var_use_audits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "env_var_use_audits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS env_vars_tenant_isolation ON "env_vars";
--> statement-breakpoint
CREATE POLICY env_vars_tenant_isolation ON "env_vars"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS env_var_use_audits_tenant_isolation ON "env_var_use_audits";
--> statement-breakpoint
CREATE POLICY env_var_use_audits_tenant_isolation ON "env_var_use_audits"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
