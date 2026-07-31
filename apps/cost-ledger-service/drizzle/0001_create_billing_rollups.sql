CREATE TABLE "billing_rollups" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_pseudonym" text NOT NULL,
  "tenant_id" uuid,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "mode" text NOT NULL,
  "internal_cost_minor" bigint NOT NULL,
  "billable_minor" bigint NOT NULL,
  "margin_minor" bigint NOT NULL,
  "detail" jsonb NOT NULL,
  "finalized" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "billing_rollups_mode_check" CHECK ("mode" IN ('workflow', 'project')),
  CONSTRAINT "billing_rollups_period_check" CHECK ("period_end" >= "period_start"),
  CONSTRAINT "billing_rollups_tenant_pseudonym_period_mode_unique" UNIQUE ("tenant_pseudonym", "period_start", "period_end", "mode")
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_billing_rollup_tenant_reassignment()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_id may only be reassigned to NULL, by the right-to-delete flow';
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE TRIGGER "billing_rollups_reject_tenant_reassignment"
BEFORE UPDATE ON "billing_rollups"
FOR EACH ROW EXECUTE FUNCTION reject_billing_rollup_tenant_reassignment();
--> statement-breakpoint
ALTER TABLE "billing_rollups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_rollups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "billing_rollups_tenant_context_isolation" ON "billing_rollups"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_billing_rollups_tenant_period" ON "billing_rollups" ("tenant_id", "period_start", "period_end");
--> statement-breakpoint
CREATE INDEX "idx_billing_rollups_pseudonym_period" ON "billing_rollups" ("tenant_pseudonym", "period_start", "period_end");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cost_ledger_provisioner') THEN
    CREATE ROLE cost_ledger_provisioner BYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "cost_events" TO cost_ledger_provisioner;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "billing_rollups" TO cost_ledger_provisioner;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cost_ledger_service') THEN
    EXECUTE 'GRANT cost_ledger_provisioner TO cost_ledger_service';
  END IF;
END $$;
