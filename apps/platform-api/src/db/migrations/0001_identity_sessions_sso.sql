ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sso_config" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "refresh_token_hash" text NOT NULL,
  "access_token_hash" text NOT NULL,
  "device_info" jsonb,
  "ip" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "revoked_at" timestamptz
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS user_sessions_prevent_tenant_id_update ON "user_sessions";
--> statement-breakpoint
CREATE TRIGGER user_sessions_prevent_tenant_id_update
BEFORE UPDATE ON "user_sessions"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS user_sessions_tenant_context_isolation ON "user_sessions";
--> statement-breakpoint
CREATE POLICY user_sessions_tenant_context_isolation ON "user_sessions"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_sessions" TO platform_provisioner;
