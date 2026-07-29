CREATE TABLE "deletion_certificates" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_pseudonym" text NOT NULL,
  "manifest" jsonb NOT NULL,
  "requested_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  "verified_by" text NOT NULL
);

CREATE TABLE "deletion_ledger" (
  "id" uuid PRIMARY KEY NOT NULL,
  "subject_pseudonym" text NOT NULL,
  "subject_selectors" jsonb NOT NULL,
  "deleted_at" timestamptz NOT NULL
);

CREATE INDEX "idx_deletion_ledger_deleted_at" ON "deletion_ledger" ("deleted_at");

CREATE OR REPLACE FUNCTION reject_deletion_record_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'deletion records are append-only';
END;
$$;

CREATE TRIGGER "deletion_certificates_append_only"
BEFORE UPDATE OR DELETE ON "deletion_certificates"
FOR EACH ROW EXECUTE FUNCTION reject_deletion_record_mutation();

CREATE TRIGGER "deletion_ledger_append_only"
BEFORE UPDATE OR DELETE ON "deletion_ledger"
FOR EACH ROW EXECUTE FUNCTION reject_deletion_record_mutation();
