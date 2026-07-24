CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "idempotency_key" text NOT NULL,
  "request_fingerprint" text NOT NULL,
  "response_status" integer NOT NULL CHECK ("response_status" BETWEEN 100 AND 599),
  "response_body" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "idempotency_keys_tenant_key_unique"
    UNIQUE ("tenant_id", "idempotency_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_at_idx"
ON "idempotency_keys" ("expires_at");
--> statement-breakpoint
DROP TRIGGER IF EXISTS idempotency_keys_prevent_tenant_id_update ON "idempotency_keys";
--> statement-breakpoint
CREATE TRIGGER idempotency_keys_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "idempotency_keys"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS idempotency_keys_tenant_isolation ON "idempotency_keys";
--> statement-breakpoint
CREATE POLICY idempotency_keys_tenant_isolation ON "idempotency_keys"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
