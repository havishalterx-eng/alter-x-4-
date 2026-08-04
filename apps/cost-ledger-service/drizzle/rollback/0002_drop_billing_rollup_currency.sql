ALTER TABLE "billing_rollups"
  DROP CONSTRAINT "billing_rollups_tenant_pseudonym_period_mode_currency_unique";
--> statement-breakpoint
ALTER TABLE "billing_rollups"
  ADD CONSTRAINT "billing_rollups_tenant_pseudonym_period_mode_unique"
  UNIQUE ("tenant_pseudonym", "period_start", "period_end", "mode");
--> statement-breakpoint
ALTER TABLE "billing_rollups"
  DROP CONSTRAINT "billing_rollups_currency_check";
--> statement-breakpoint
ALTER TABLE "billing_rollups"
  DROP COLUMN "currency";
