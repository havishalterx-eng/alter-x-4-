CREATE TABLE IF NOT EXISTS "staff_users" ("id" text PRIMARY KEY CHECK ("id" LIKE 'stf\_%'), "identity_ref" text NOT NULL UNIQUE, "email" text NOT NULL, "roles" text[] NOT NULL CHECK (cardinality("roles") > 0 AND "roles" <@ ARRAY['staff_admin', 'staff_support', 'staff_billing_ops', 'staff_security']::text[]), "created_at" timestamptz NOT NULL DEFAULT now(), "deactivated_at" timestamptz);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jit_grants" ("id" text PRIMARY KEY CHECK ("id" LIKE 'jit\_%'), "staff_user_id" text NOT NULL REFERENCES "staff_users"("id"), "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"), "reason_code" text NOT NULL, "reason_text" text NOT NULL, "granted_at" timestamptz NOT NULL DEFAULT now(), "expires_at" timestamptz NOT NULL, "revoked_at" timestamptz, "revoked_by" text, CHECK ("expires_at" > "granted_at"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jit_grant_audit" ("id" text PRIMARY KEY CHECK ("id" LIKE 'jta\_%'), "jit_grant_id" text NOT NULL REFERENCES "jit_grants"("id"), "action" text NOT NULL CHECK ("action" IN ('granted','used','expired','revoked')), "actor_id" text NOT NULL, "occurred_at" timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jit_grants_staff_tenant_idx" ON "jit_grants" ("staff_user_id", "tenant_id", "expires_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_jit_grant_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'jit_grant_audit is append-only'; END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS jit_grant_audit_append_only ON "jit_grant_audit";
--> statement-breakpoint
CREATE TRIGGER jit_grant_audit_append_only BEFORE UPDATE OR DELETE ON "jit_grant_audit" FOR EACH ROW EXECUTE FUNCTION prevent_jit_grant_audit_mutation();
