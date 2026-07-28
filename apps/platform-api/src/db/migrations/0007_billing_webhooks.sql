ALTER TABLE "entitlements"
ADD COLUMN IF NOT EXISTS "access_state" text NOT NULL DEFAULT 'active'
CHECK ("access_state" IN ('active', 'grace', 'limited', 'suspended'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_events" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "provider_id" text NOT NULL,
  "provider_event_id" text NOT NULL UNIQUE,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  CONSTRAINT "billing_events_tenant_provider_event_unique"
    UNIQUE ("tenant_id", "provider_event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_dunning_states" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id"),
  "state" text NOT NULL DEFAULT 'active'
    CHECK ("state" IN ('active', 'grace', 'limited', 'suspended')),
  "current_plan" text,
  "first_failed_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_dunning_audits" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "id" uuid PRIMARY KEY,
  "provider_event_id" text NOT NULL,
  "from_state" text NOT NULL
    CHECK ("from_state" IN ('active', 'grace', 'limited', 'suspended')),
  "to_state" text NOT NULL
    CHECK ("to_state" IN ('active', 'grace', 'limited', 'suspended')),
  "reason" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_dunning_audits_tenant_created_at_idx"
ON "billing_dunning_audits" ("tenant_id", "created_at");
--> statement-breakpoint
DROP TRIGGER IF EXISTS billing_events_prevent_tenant_id_update ON "billing_events";
--> statement-breakpoint
CREATE TRIGGER billing_events_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "billing_events"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS billing_dunning_states_prevent_tenant_id_update
ON "billing_dunning_states";
--> statement-breakpoint
CREATE TRIGGER billing_dunning_states_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "billing_dunning_states"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS billing_dunning_audits_prevent_tenant_id_update
ON "billing_dunning_audits";
--> statement-breakpoint
CREATE TRIGGER billing_dunning_audits_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "billing_dunning_audits"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "billing_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_dunning_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_dunning_states" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_dunning_audits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_dunning_audits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS billing_events_tenant_isolation ON "billing_events";
--> statement-breakpoint
CREATE POLICY billing_events_tenant_isolation ON "billing_events"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS billing_dunning_states_tenant_isolation
ON "billing_dunning_states";
--> statement-breakpoint
CREATE POLICY billing_dunning_states_tenant_isolation ON "billing_dunning_states"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS billing_dunning_audits_tenant_isolation
ON "billing_dunning_audits";
--> statement-breakpoint
CREATE POLICY billing_dunning_audits_tenant_isolation ON "billing_dunning_audits"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
