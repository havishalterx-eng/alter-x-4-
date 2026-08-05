CREATE TABLE IF NOT EXISTS "tenant_admin_actions" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'taa\_%'),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "staff_user_id" text NOT NULL REFERENCES "staff_users"("id"),
  "action" text NOT NULL
    CHECK ("action" IN ('provisioned', 'suspended', 'reinstated', 'entitlement_overridden')),
  "reason" text,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_admin_actions_tenant_idx"
ON "tenant_admin_actions" ("tenant_id", "occurred_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_tenant_admin_action_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'tenant_admin_actions is append-only'; END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_admin_actions_append_only ON "tenant_admin_actions";
--> statement-breakpoint
CREATE TRIGGER tenant_admin_actions_append_only
BEFORE UPDATE OR DELETE ON "tenant_admin_actions"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_admin_action_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION admin_list_tenants()
RETURNS TABLE (
  "id" uuid,
  "name" text,
  "status" text,
  "region" text,
  "identity_org_ref" text,
  "created_at" timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
SET row_security TO off
AS $$
  SELECT id, name, status, region, identity_org_ref, created_at
    FROM tenants
   ORDER BY created_at DESC;
$$;
--> statement-breakpoint
ALTER FUNCTION admin_list_tenants() OWNER TO platform_provisioner;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_list_tenants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_list_tenants() TO platform_api;
