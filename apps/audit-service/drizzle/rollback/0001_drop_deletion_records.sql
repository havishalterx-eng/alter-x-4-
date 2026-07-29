DROP TRIGGER IF EXISTS "deletion_ledger_append_only" ON "deletion_ledger";
DROP TRIGGER IF EXISTS "deletion_certificates_append_only" ON "deletion_certificates";
DROP FUNCTION IF EXISTS reject_deletion_record_mutation();
DROP TABLE IF EXISTS "deletion_ledger";
DROP TABLE IF EXISTS "deletion_certificates";
