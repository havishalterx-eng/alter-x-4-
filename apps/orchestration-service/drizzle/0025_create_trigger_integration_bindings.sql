-- ENG-BINDING: trigger-to-integration binding, per-integration webhook
-- endpoints, and webhook signing-secret rotation.
--
-- webhook_endpoint_secrets stores a SecretsProvider REFERENCE only. The
-- signing secret itself is never written to this database; `secret_ref`
-- addresses material held by the provider and is useless without provider
-- access.
CREATE TABLE "webhook_endpoints" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  -- Opaque cross-service reference to platform-api's oauth_connections.id.
  -- The two services do not share a database, so this deliberately has no
  -- foreign key; shape is validated in the service layer, existence is not.
  "integration_id" uuid NOT NULL,
  -- 256 bits of CSPRNG entropy, base64url. This is the unguessable part of
  -- the endpoint URL, not an authenticator: possession of the URL alone
  -- cannot produce a valid request, because every delivery must also carry
  -- a valid HMAC signature.
  "path_token" text NOT NULL,
  "max_skew_seconds" integer DEFAULT 300 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_endpoints_path_token_unique" UNIQUE ("path_token"),
  CONSTRAINT "webhook_endpoints_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  -- One endpoint per integration connection, per workspace.
  CONSTRAINT "webhook_endpoints_tenant_workspace_integration_unique"
    UNIQUE ("tenant_id", "workspace_id", "integration_id"),
  CONSTRAINT "webhook_endpoints_max_skew_seconds_check"
    CHECK ("max_skew_seconds" BETWEEN 30 AND 900)
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint_secrets" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "endpoint_id" text NOT NULL,
  "version" integer NOT NULL,
  -- SecretsProvider reference. NEVER the secret value.
  "secret_ref" text NOT NULL,
  -- Two states only. 'revoked' is terminal and, under the declared
  -- hard-cutover rotation model, is reached the instant a rotation commits;
  -- signature verification only ever reads the single 'active' row.
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "revoked_at" timestamptz,
  CONSTRAINT "webhook_endpoint_secrets_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "webhook_endpoint_secrets_tenant_endpoint_version_unique"
    UNIQUE ("tenant_id", "endpoint_id", "version"),
  CONSTRAINT "webhook_endpoint_secrets_status_check"
    CHECK ("status" IN ('active', 'revoked')),
  CONSTRAINT "webhook_endpoint_secrets_revoked_at_check"
    CHECK (("status" = 'active' AND "revoked_at" IS NULL)
        OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL)),
  CONSTRAINT "webhook_endpoint_secrets_endpoint_tenant_fk"
    FOREIGN KEY ("tenant_id", "endpoint_id")
    REFERENCES "webhook_endpoints" ("tenant_id", "id")
);
--> statement-breakpoint
-- Database-level guarantee that an endpoint can never have two simultaneously
-- valid signing secrets. A rotation that failed to revoke the previous row
-- cannot commit.
CREATE UNIQUE INDEX "webhook_endpoint_secrets_single_active"
ON "webhook_endpoint_secrets" ("tenant_id", "endpoint_id")
WHERE "status" = 'active';
--> statement-breakpoint
CREATE TABLE "trigger_integration_bindings" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "trigger_id" text NOT NULL,
  "integration_id" uuid NOT NULL,
  "webhook_endpoint_id" text NOT NULL,
  "config" jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "trigger_integration_bindings_tenant_id_id_unique"
    UNIQUE ("tenant_id", "id"),
  CONSTRAINT "trigger_integration_bindings_tenant_trigger_integration_unique"
    UNIQUE ("tenant_id", "trigger_id", "integration_id"),
  CONSTRAINT "trigger_integration_bindings_status_check"
    CHECK ("status" IN ('active', 'disabled')),
  CONSTRAINT "trigger_integration_bindings_trigger_tenant_fk"
    FOREIGN KEY ("tenant_id", "trigger_id")
    REFERENCES "triggers" ("tenant_id", "id"),
  CONSTRAINT "trigger_integration_bindings_endpoint_tenant_fk"
    FOREIGN KEY ("tenant_id", "webhook_endpoint_id")
    REFERENCES "webhook_endpoints" ("tenant_id", "id")
);
--> statement-breakpoint
CREATE TRIGGER "webhook_endpoints_reject_tenant_id_change"
BEFORE UPDATE ON "webhook_endpoints"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER "webhook_endpoint_secrets_reject_tenant_id_change"
BEFORE UPDATE ON "webhook_endpoint_secrets"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER "trigger_integration_bindings_reject_tenant_id_change"
BEFORE UPDATE ON "trigger_integration_bindings"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "webhook_endpoints_tenant_context_isolation" ON "webhook_endpoints"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "webhook_endpoint_secrets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoint_secrets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "webhook_endpoint_secrets_tenant_context_isolation" ON "webhook_endpoint_secrets"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "trigger_integration_bindings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trigger_integration_bindings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "trigger_integration_bindings_tenant_context_isolation" ON "trigger_integration_bindings"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_webhook_endpoints_tenant_workspace"
ON "webhook_endpoints" ("tenant_id", "workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_trigger_integration_bindings_trigger"
ON "trigger_integration_bindings" ("tenant_id", "trigger_id");
--> statement-breakpoint
CREATE INDEX "idx_trigger_integration_bindings_endpoint"
ON "trigger_integration_bindings" ("tenant_id", "webhook_endpoint_id", "status");
--> statement-breakpoint
-- The public webhook receiver cannot know a tenant before it has verified the
-- signature, so it cannot run under RLS tenant context. This function exposes
-- only what verification and routing require, and only for the single
-- currently-ACTIVE secret: a revoked secret is unreachable through it, which
-- is what makes rotation a real invalidation rather than a bookkeeping flag.
-- It returns a secret REFERENCE, never secret material.
CREATE FUNCTION resolve_webhook_endpoint(p_path_token text)
RETURNS TABLE (
  endpoint_id text,
  tenant_id uuid,
  workspace_id uuid,
  integration_id uuid,
  max_skew_seconds integer,
  secret_ref text,
  secret_version integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.tenant_id, e.workspace_id, e.integration_id,
         e.max_skew_seconds, s.secret_ref, s.version
  FROM webhook_endpoints e
  JOIN webhook_endpoint_secrets s
    ON s.tenant_id = e.tenant_id
   AND s.endpoint_id = e.id
   AND s.status = 'active'
  WHERE e.path_token = p_path_token
  LIMIT 1;
$$;
