ALTER TABLE "listings"
ADD COLUMN "price_minor" bigint NOT NULL DEFAULT 0
  CONSTRAINT "listings_price_minor_range" CHECK ("price_minor" BETWEEN 0 AND 9007199254740991),
ADD COLUMN "currency" text NOT NULL DEFAULT 'INR'
  CONSTRAINT "listings_currency_inr" CHECK ("currency" = 'INR'),
ADD CONSTRAINT "listings_paid_launch_gate" CHECK ("price_minor" = 0 OR "status" <> 'published');
