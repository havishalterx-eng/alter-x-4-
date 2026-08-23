ALTER TABLE "cost_events"
  DROP CONSTRAINT "cost_events_amount_usd_check",
  DROP CONSTRAINT "cost_events_fx_rate_used_check";
--> statement-breakpoint
ALTER TABLE "cost_events"
  DROP COLUMN "amount_usd",
  DROP COLUMN "fx_rate_used";
