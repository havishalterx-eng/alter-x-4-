DROP INDEX IF EXISTS "idx_deployments_project";
DROP TRIGGER IF EXISTS "deployments_reject_tenant_id_change" ON "deployments";
DROP TABLE IF EXISTS "deployments";
DROP TRIGGER IF EXISTS "projects_reject_tenant_id_change" ON "projects";
DROP TABLE IF EXISTS "projects";
