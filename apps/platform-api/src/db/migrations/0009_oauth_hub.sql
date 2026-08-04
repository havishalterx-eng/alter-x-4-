CREATE TABLE IF NOT EXISTS "oauth_states" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "id" text PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "connector" text NOT NULL,
  "code_verifier" text,
  "redirect_uri" text NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_states_expires_at_idx"
ON "oauth_states" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_states_tenant_workspace_idx"
ON "oauth_states" ("tenant_id", "workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_connections" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "connector" text NOT NULL,
  "external_account_id" text NOT NULL,
  "scopes" text NOT NULL,
  "status" text NOT NULL DEFAULT 'connected'
    CHECK ("status" IN ('connected', 'revoked', 'error')),
  "last_health_status" text,
  "last_health_checked_at" timestamptz,
  "revoked_at" timestamptz,
  "use_audit_ptr" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "oauth_connections_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "oauth_connections_tenant_workspace_connector_account_unique"
    UNIQUE ("tenant_id", "workspace_id", "connector", "external_account_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_connections_tenant_workspace_idx"
ON "oauth_connections" ("tenant_id", "workspace_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_connection_use_audits" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "id" uuid PRIMARY KEY,
  "connection_id" uuid NOT NULL,
  "used_by" uuid NOT NULL,
  "action" text NOT NULL,
  "used_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "oauth_connection_use_audits_tenant_connection_fk"
    FOREIGN KEY ("tenant_id", "connection_id")
    REFERENCES "oauth_connections"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_connection_use_audits_tenant_connection_idx"
ON "oauth_connection_use_audits" ("tenant_id", "connection_id");
--> statement-breakpoint
DROP TRIGGER IF EXISTS oauth_states_prevent_tenant_id_update ON "oauth_states";
--> statement-breakpoint
CREATE TRIGGER oauth_states_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "oauth_states"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS oauth_connections_prevent_tenant_id_update ON "oauth_connections";
--> statement-breakpoint
CREATE TRIGGER oauth_connections_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "oauth_connections"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS oauth_connection_use_audits_prevent_tenant_id_update ON "oauth_connection_use_audits";
--> statement-breakpoint
CREATE TRIGGER oauth_connection_use_audits_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "oauth_connection_use_audits"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "oauth_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_states" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_connection_use_audits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_connection_use_audits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS oauth_states_tenant_isolation ON "oauth_states";
--> statement-breakpoint
CREATE POLICY oauth_states_tenant_isolation ON "oauth_states"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS oauth_connections_tenant_isolation ON "oauth_connections";
--> statement-breakpoint
CREATE POLICY oauth_connections_tenant_isolation ON "oauth_connections"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS oauth_connection_use_audits_tenant_isolation ON "oauth_connection_use_audits";
--> statement-breakpoint
CREATE POLICY oauth_connection_use_audits_tenant_isolation ON "oauth_connection_use_audits"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
