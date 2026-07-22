CREATE TABLE IF NOT EXISTS "tenants" (
  "id" uuid PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL,
  "region" text DEFAULT 'ap-south-1' NOT NULL,
  "identity_org_ref" text,
  "data_residency" jsonb,
  "retention_overrides" jsonb,
  "security_policy" jsonb,
  "billing_profile_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY NOT NULL,
  "identity_ref" text NOT NULL,
  "email" text NOT NULL,
  "display_name" text,
  "status" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" text NOT NULL,
  "status" text NOT NULL,
  "default_model_policy" jsonb,
  "default_tool_policy" jsonb,
  "budget" jsonb,
  "ads_scope_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_members" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "role" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_members" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "role" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entitlements" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "plan" text NOT NULL,
  "limits" jsonb,
  "effective_from" timestamptz,
  "effective_to" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_tenant_id_name_unique" ON "workspaces" ("tenant_id", "name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_members_tenant_id_user_id_unique" ON "tenant_members" ("tenant_id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_members_workspace_id_user_id_unique" ON "workspace_members" ("workspace_id", "user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_tenant_id_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenants_set_updated_at ON "tenants";
--> statement-breakpoint
CREATE TRIGGER tenants_set_updated_at
BEFORE UPDATE ON "tenants"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS users_set_updated_at ON "users";
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON "users"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS workspaces_set_updated_at ON "workspaces";
--> statement-breakpoint
CREATE TRIGGER workspaces_set_updated_at
BEFORE UPDATE ON "workspaces"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS workspaces_prevent_tenant_id_update ON "workspaces";
--> statement-breakpoint
CREATE TRIGGER workspaces_prevent_tenant_id_update
BEFORE UPDATE ON "workspaces"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_members_prevent_tenant_id_update ON "tenant_members";
--> statement-breakpoint
CREATE TRIGGER tenant_members_prevent_tenant_id_update
BEFORE UPDATE ON "tenant_members"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_members_prevent_tenant_id_update ON "workspace_members";
--> statement-breakpoint
CREATE TRIGGER workspace_members_prevent_tenant_id_update
BEFORE UPDATE ON "workspace_members"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS entitlements_prevent_tenant_id_update ON "entitlements";
--> statement-breakpoint
CREATE TRIGGER entitlements_prevent_tenant_id_update
BEFORE UPDATE ON "entitlements"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspace_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "entitlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "entitlements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenants_tenant_context_isolation ON "tenants";
--> statement-breakpoint
CREATE POLICY tenants_tenant_context_isolation ON "tenants"
USING ("id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS workspaces_tenant_context_isolation ON "workspaces";
--> statement-breakpoint
CREATE POLICY workspaces_tenant_context_isolation ON "workspaces"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_members_tenant_context_isolation ON "tenant_members";
--> statement-breakpoint
CREATE POLICY tenant_members_tenant_context_isolation ON "tenant_members"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS workspace_members_tenant_context_isolation ON "workspace_members";
--> statement-breakpoint
CREATE POLICY workspace_members_tenant_context_isolation ON "workspace_members"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS entitlements_tenant_context_isolation ON "entitlements";
--> statement-breakpoint
CREATE POLICY entitlements_tenant_context_isolation ON "entitlements"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_provisioner') THEN
    CREATE ROLE platform_provisioner BYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenants", "workspaces", "users", "tenant_members", "workspace_members", "entitlements" TO platform_provisioner;
