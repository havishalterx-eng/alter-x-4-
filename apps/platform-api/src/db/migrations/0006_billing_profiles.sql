CREATE TABLE IF NOT EXISTS "billing_profiles" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "id" uuid PRIMARY KEY,
  "provider_id" text NOT NULL,
  "provider_customer_ref" text,
  "subscription_ref" text,
  "status" text NOT NULL,
  "current_plan" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_profiles_tenant_id_unique" UNIQUE ("tenant_id"),
  CONSTRAINT "billing_profiles_tenant_id_id_unique" UNIQUE ("tenant_id", "id")
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenants_billing_profile_fk'
      AND conrelid = 'tenants'::regclass
  ) THEN
    ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_billing_profile_fk"
    FOREIGN KEY ("billing_profile_id") REFERENCES "billing_profiles"("id")
    ON DELETE SET NULL;
  END IF;
END
$$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_payment_method_refs" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "ref" text NOT NULL,
  "type" text NOT NULL,
  "brand" text,
  "last4" text CHECK ("last4" IS NULL OR char_length("last4") <= 4),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "billing_payment_method_refs_tenant_ref_unique"
    UNIQUE ("tenant_id", "ref")
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS billing_profiles_prevent_tenant_id_update ON "billing_profiles";
--> statement-breakpoint
CREATE TRIGGER billing_profiles_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "billing_profiles"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS billing_payment_method_refs_prevent_tenant_id_update
ON "billing_payment_method_refs";
--> statement-breakpoint
CREATE TRIGGER billing_payment_method_refs_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "billing_payment_method_refs"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "billing_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_payment_method_refs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_payment_method_refs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS billing_profiles_tenant_isolation ON "billing_profiles";
--> statement-breakpoint
CREATE POLICY billing_profiles_tenant_isolation ON "billing_profiles"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS billing_payment_method_refs_tenant_isolation
ON "billing_payment_method_refs";
--> statement-breakpoint
CREATE POLICY billing_payment_method_refs_tenant_isolation
ON "billing_payment_method_refs"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
