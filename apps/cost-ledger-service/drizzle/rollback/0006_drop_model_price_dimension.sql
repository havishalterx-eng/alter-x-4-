-- Reverses 0006. Model-specific rows cannot survive without the column that
-- tells them apart -- two models on one provider would collide on the old
-- (provider, resource) key -- so they are removed first. Provider-wide rows
-- (model_id = '') are kept.
DELETE FROM "model_pricing" WHERE "model_id" <> '';
--> statement-breakpoint

ALTER TABLE "model_pricing" DROP CONSTRAINT "model_pricing_pk";
--> statement-breakpoint

ALTER TABLE "model_pricing" DROP COLUMN "model_id";
--> statement-breakpoint

ALTER TABLE "model_pricing"
  ADD CONSTRAINT "model_pricing_pk" PRIMARY KEY ("provider", "resource");
--> statement-breakpoint

-- Lossy by necessity: bigint has nowhere to put a fractional price, which is
-- the reason 0006 exists. Rounded rather than truncated.
ALTER TABLE "model_pricing"
  ALTER COLUMN "unit_cost_minor" TYPE bigint USING round("unit_cost_minor")::bigint;
