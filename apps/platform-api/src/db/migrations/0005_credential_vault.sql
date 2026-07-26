CREATE TABLE IF NOT EXISTS "credential_refs" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "connector" text NOT NULL,
  "scope" text NOT NULL,
  "last4" text NOT NULL CHECK (char_length("last4") <= 4),
  "use_audit_ptr" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "credential_refs_tenant_id_id_unique" UNIQUE ("tenant_id", "id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credential_refs_tenant_created_at_idx"
ON "credential_refs" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credential_use_audits" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "id" uuid PRIMARY KEY,
  "credential_id" uuid NOT NULL,
  "used_by" uuid NOT NULL,
  "used_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "credential_use_audits_tenant_credential_fk"
    FOREIGN KEY ("tenant_id", "credential_id")
    REFERENCES "credential_refs"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credential_use_audits_tenant_credential_idx"
ON "credential_use_audits" ("tenant_id", "credential_id");
--> statement-breakpoint
DROP TRIGGER IF EXISTS credential_refs_prevent_tenant_id_update ON "credential_refs";
--> statement-breakpoint
CREATE TRIGGER credential_refs_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "credential_refs"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS credential_use_audits_prevent_tenant_id_update ON "credential_use_audits";
--> statement-breakpoint
CREATE TRIGGER credential_use_audits_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "credential_use_audits"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "credential_refs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credential_refs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credential_use_audits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credential_use_audits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS credential_refs_tenant_isolation ON "credential_refs";
--> statement-breakpoint
CREATE POLICY credential_refs_tenant_isolation ON "credential_refs"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS credential_use_audits_tenant_isolation ON "credential_use_audits";
--> statement-breakpoint
CREATE POLICY credential_use_audits_tenant_isolation ON "credential_use_audits"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
