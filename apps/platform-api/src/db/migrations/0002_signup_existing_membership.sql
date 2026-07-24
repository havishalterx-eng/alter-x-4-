-- Bootstrap-only cross-tenant lookup. Keep its output and EXECUTE grant narrow;
-- every tenant-scoped application query must continue through RLS context.
CREATE OR REPLACE FUNCTION resolve_existing_signup(
  p_identity_ref text,
  p_tenant_hint uuid DEFAULT NULL
)
RETURNS TABLE (
  "userId" uuid,
  "tenantId" uuid,
  "workspaceId" uuid,
  "tenantRole" text,
  "workspaceRole" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
SET row_security TO off
AS $$
  SELECT u.id, tm.tenant_id, wm.workspace_id, tm.role, wm.role
    FROM users u
    JOIN tenant_members tm ON tm.user_id = u.id
    JOIN workspace_members wm
      ON wm.tenant_id = tm.tenant_id AND wm.user_id = tm.user_id
   WHERE u.identity_ref = p_identity_ref
   ORDER BY CASE WHEN tm.tenant_id = p_tenant_hint THEN 0 ELSE 1 END,
            tm.created_at DESC, wm.created_at DESC
   LIMIT 1
$$;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO platform_provisioner',
    current_schema()
  );
END
$$;
--> statement-breakpoint
ALTER FUNCTION resolve_existing_signup(text, uuid) OWNER TO platform_provisioner;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_existing_signup(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_existing_signup(text, uuid) TO platform_api;
