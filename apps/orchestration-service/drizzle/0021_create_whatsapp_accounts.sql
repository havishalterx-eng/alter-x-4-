CREATE TABLE "whatsapp_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "phone_number_id" text NOT NULL,
  "waba_id" text NOT NULL,
  "access_token_ref" text NOT NULL,
  "status" text DEFAULT 'connected' NOT NULL,
  "monitoring_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "media_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "escalation_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_accounts_phone_number_id_unique" UNIQUE ("phone_number_id"),
  CONSTRAINT "whatsapp_accounts_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "whatsapp_accounts_status_check" CHECK ("status" IN ('connected', 'disconnected'))
);
--> statement-breakpoint
CREATE TRIGGER "whatsapp_accounts_reject_tenant_id_change"
BEFORE UPDATE ON "whatsapp_accounts"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "whatsapp_accounts_tenant_context_isolation" ON "whatsapp_accounts"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_whatsapp_accounts_tenant_workspace" ON "whatsapp_accounts" ("tenant_id", "workspace_id");
--> statement-breakpoint
-- The public webhook cannot know a tenant before it verifies Meta's signed
-- payload. This function exposes only active routing identifiers; account
-- management remains subject to RLS in the application service.
CREATE FUNCTION resolve_whatsapp_routing(p_phone_number_id text)
RETURNS TABLE (account_id text, tenant_id uuid, workspace_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id, workspace_id
  FROM whatsapp_accounts
  WHERE phone_number_id = p_phone_number_id
    AND status = 'connected'
  LIMIT 1;
$$;
