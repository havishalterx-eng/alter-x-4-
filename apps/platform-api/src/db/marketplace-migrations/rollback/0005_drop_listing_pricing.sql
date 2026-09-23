ALTER TABLE "listings" DROP CONSTRAINT IF EXISTS "listings_paid_launch_gate";
ALTER TABLE "listings" DROP COLUMN IF EXISTS "currency";
ALTER TABLE "listings" DROP COLUMN IF EXISTS "price_minor";
