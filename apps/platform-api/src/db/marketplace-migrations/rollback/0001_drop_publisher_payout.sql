DROP TRIGGER IF EXISTS payout_ledger_append_only ON "payout_ledger";
--> statement-breakpoint
DROP TRIGGER IF EXISTS payout_ledger_tenant_id_immutable ON "payout_ledger";
--> statement-breakpoint
DROP TRIGGER IF EXISTS payouts_tenant_id_immutable ON "payouts";
--> statement-breakpoint
DROP TRIGGER IF EXISTS kyc_submissions_tenant_id_immutable ON "kyc_submissions";
--> statement-breakpoint
DROP TRIGGER IF EXISTS publishers_tenant_id_immutable ON "publishers";
--> statement-breakpoint
DROP FUNCTION IF EXISTS reject_payout_ledger_mutation();
--> statement-breakpoint
DROP FUNCTION IF EXISTS reject_publisher_tenant_id_change();
--> statement-breakpoint
DROP TABLE IF EXISTS "payout_ledger";
--> statement-breakpoint
DROP TABLE IF EXISTS "payouts";
--> statement-breakpoint
DROP TABLE IF EXISTS "kyc_submissions";
--> statement-breakpoint
DROP TABLE IF EXISTS "publishers";
