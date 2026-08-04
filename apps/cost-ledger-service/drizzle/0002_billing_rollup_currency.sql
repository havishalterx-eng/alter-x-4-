ALTER TABLE "billing_rollups"
  ADD COLUMN "currency" text NOT NULL DEFAULT 'USD';
--> statement-breakpoint
ALTER TABLE "billing_rollups"
  ADD CONSTRAINT "billing_rollups_currency_check" CHECK ("currency" IN ('USD', 'INR'));
--> statement-breakpoint
ALTER TABLE "billing_rollups"
  DROP CONSTRAINT "billing_rollups_tenant_pseudonym_period_mode_unique";
--> statement-breakpoint
ALTER TABLE "billing_rollups"
  ADD CONSTRAINT "billing_rollups_tenant_pseudonym_period_mode_currency_unique"
  UNIQUE ("tenant_pseudonym", "period_start", "period_end", "mode", "currency");
