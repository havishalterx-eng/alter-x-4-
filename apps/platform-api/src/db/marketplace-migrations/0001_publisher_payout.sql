CREATE TABLE IF NOT EXISTS "publishers" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'pub\_%'),
  "tenant_id" text NOT NULL UNIQUE,
  "verification_status" text NOT NULL CHECK ("verification_status" IN ('unverified','pending_review','verified','rejected')),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kyc_submissions" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'kyc\_%'),
  "tenant_id" text NOT NULL,
  "publisher_id" text NOT NULL REFERENCES "publishers"("id"),
  "documents_json" jsonb NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('pending_review','approved','rejected')),
  "rejection_reason" text,
  "reviewed_by" text,
  "submitted_at" timestamptz NOT NULL DEFAULT now(),
  "reviewed_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payouts" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'pay\_%'),
  "tenant_id" text NOT NULL,
  "order_id" text NOT NULL REFERENCES "orders"("id"),
  "publisher_id" text NOT NULL REFERENCES "publishers"("id"),
  "total_minor" bigint NOT NULL CHECK ("total_minor" > 0),
  "seller_share_minor" bigint NOT NULL CHECK ("seller_share_minor" >= 0),
  "platform_share_minor" bigint NOT NULL CHECK ("platform_share_minor" >= 0),
  "status" text NOT NULL CHECK ("status" IN ('created','pending','processed','failed')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payouts_share_reconciles" CHECK ("seller_share_minor" + "platform_share_minor" = "total_minor"),
  CONSTRAINT "payouts_order_unique" UNIQUE ("order_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payout_ledger" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'led\_%'),
  "tenant_id" text NOT NULL,
  "payout_id" text NOT NULL REFERENCES "payouts"("id"),
  "entry_type" text NOT NULL CHECK ("entry_type" IN ('payout_created','payout_pending','payout_processed','payout_failed')),
  "amount_minor" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kyc_submissions_tenant_submitted_idx" ON "kyc_submissions" ("tenant_id", "submitted_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payouts_tenant_created_idx" ON "payouts" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_ledger_tenant_created_idx" ON "payout_ledger" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "publishers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "publishers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "kyc_submissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "kyc_submissions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payouts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payouts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payout_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payout_ledger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "publishers_tenant_isolation" ON "publishers"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''))
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY "kyc_submissions_tenant_isolation" ON "kyc_submissions"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''))
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY "payouts_tenant_isolation" ON "payouts"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''))
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY "payout_ledger_tenant_isolation" ON "payout_ledger"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''))
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''));
--> statement-breakpoint
CREATE FUNCTION reject_publisher_tenant_id_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER publishers_tenant_id_immutable BEFORE UPDATE ON "publishers" FOR EACH ROW EXECUTE FUNCTION reject_publisher_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER kyc_submissions_tenant_id_immutable BEFORE UPDATE ON "kyc_submissions" FOR EACH ROW EXECUTE FUNCTION reject_publisher_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER payouts_tenant_id_immutable BEFORE UPDATE ON "payouts" FOR EACH ROW EXECUTE FUNCTION reject_publisher_tenant_id_change();
--> statement-breakpoint
CREATE TRIGGER payout_ledger_tenant_id_immutable BEFORE UPDATE ON "payout_ledger" FOR EACH ROW EXECUTE FUNCTION reject_publisher_tenant_id_change();
--> statement-breakpoint
CREATE FUNCTION reject_payout_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payout_ledger is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payout_ledger_append_only
BEFORE UPDATE OR DELETE ON "payout_ledger"
FOR EACH ROW EXECUTE FUNCTION reject_payout_ledger_mutation();
