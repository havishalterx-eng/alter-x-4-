DROP TRIGGER IF EXISTS "cost_events_reject_tenant_id_change" ON "cost_events";
DROP TABLE IF EXISTS "cost_events";
DROP FUNCTION IF EXISTS reject_tenant_id_change();
