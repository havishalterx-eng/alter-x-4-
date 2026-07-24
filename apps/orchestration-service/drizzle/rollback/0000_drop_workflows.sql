DROP TRIGGER IF EXISTS "workflows_reject_tenant_id_change" ON "workflows";
DROP TABLE IF EXISTS "workflows";
DROP FUNCTION IF EXISTS reject_tenant_id_change();
