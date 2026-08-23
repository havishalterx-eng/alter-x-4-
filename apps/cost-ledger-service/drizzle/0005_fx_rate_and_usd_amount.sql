-- ENGINE-FIX-P3-24 (Wave 3 item 8). cost-ingest.service.ts's
-- deriveInternalCostMinorInr always converted amount_json.usd to
-- internal_cost_minor (INR paise) using the configured usdToInrRate, but
-- persisted only the converted result -- never the rate applied, never the
-- original USD amount. A rate change makes old rows silently incomparable
-- to new ones, with nothing in the data marking where the boundary is.
--
-- Additive, nullable, no backfill: existing rows get NULL for both new
-- columns, which is honest (the rate that actually produced their
-- internal_cost_minor was never recorded, so there is nothing real to
-- backfill it with) and self-documenting (any row with fx_rate_used IS
-- NULL predates this fix).
ALTER TABLE "cost_events"
  ADD COLUMN "fx_rate_used" numeric,
  ADD COLUMN "amount_usd" numeric;
--> statement-breakpoint
ALTER TABLE "cost_events"
  ADD CONSTRAINT "cost_events_fx_rate_used_check" CHECK ("fx_rate_used" IS NULL OR "fx_rate_used" > 0),
  ADD CONSTRAINT "cost_events_amount_usd_check" CHECK ("amount_usd" IS NULL OR "amount_usd" >= 0);
