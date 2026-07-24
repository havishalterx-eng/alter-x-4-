DROP TRIGGER IF EXISTS "audit_events_immutable" ON "audit_events";
DROP FUNCTION IF EXISTS reject_audit_event_mutation();
DROP TABLE IF EXISTS "audit_events";
