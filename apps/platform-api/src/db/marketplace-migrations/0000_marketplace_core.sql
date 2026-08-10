CREATE TABLE IF NOT EXISTS "listings" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'lst\_%'),
  "tenant_id" text,
  "type" text NOT NULL CHECK ("type" IN ('workflow_template','project_template','agent','tool')),
  "name" text NOT NULL,
  "description" text,
  "latest_version" text,
  "license_type" text NOT NULL CHECK ("license_type" IN ('single_workspace','tenant_wide')),
  "status" text NOT NULL CHECK ("status" IN ('draft','private_testing','submitted','automated_review','human_review','published','suspended','deprecated','removed')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_versions" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'lsv\_%'),
  "listing_id" text NOT NULL REFERENCES "listings"("id"),
  "version" text NOT NULL,
  "payload_ref" text NOT NULL,
  "compatibility_json" jsonb NOT NULL,
  "published_at" timestamptz,
  CONSTRAINT "listing_versions_listing_id_version_unique" UNIQUE ("listing_id", "version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installs" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'ins\_%'),
  "tenant_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "listing_id" text NOT NULL REFERENCES "listings"("id"),
  "listing_version_id" text NOT NULL REFERENCES "listing_versions"("id"),
  "installed_payload_ref" text NOT NULL,
  "license_type" text NOT NULL CHECK ("license_type" IN ('single_workspace','tenant_wide')),
  "idempotency_key" text NOT NULL,
  "installed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "installs_tenant_id_idempotency_key_unique" UNIQUE ("tenant_id", "idempotency_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'ord\_%'),
  "tenant_id" text NOT NULL,
  "listing_id" text NOT NULL REFERENCES "listings"("id"),
  "listing_version_id" text NOT NULL REFERENCES "listing_versions"("id"),
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('pending','paid','failed','refunded')),
  "payment_reference" text,
  "idempotency_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "orders_tenant_id_idempotency_key_unique" UNIQUE ("tenant_id", "idempotency_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
  "id" text PRIMARY KEY CHECK ("id" LIKE 'rev\_%'),
  "tenant_id" text NOT NULL,
  "listing_id" text NOT NULL REFERENCES "listings"("id"),
  "install_id" text NOT NULL REFERENCES "installs"("id"),
  "rating" smallint NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
  "comment" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reviews_tenant_id_listing_id_unique" UNIQUE ("tenant_id", "listing_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_status_type_created_at_idx"
ON "listings" ("status", "type", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_tenant_id_idx"
ON "listings" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_versions_listing_id_idx"
ON "listing_versions" ("listing_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "installs_tenant_workspace_installed_at_idx"
ON "installs" ("tenant_id", "workspace_id", "installed_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "installs_listing_id_idx"
ON "installs" ("listing_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "installs_listing_version_id_idx"
ON "installs" ("listing_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_listing_id_idx"
ON "orders" ("listing_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_listing_version_id_idx"
ON "orders" ("listing_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_listing_id_created_at_idx"
ON "reviews" ("listing_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_install_id_idx"
ON "reviews" ("install_id");
--> statement-breakpoint
ALTER TABLE "listings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "listings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "listing_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "listing_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "installs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "installs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reviews" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "listings_published_read" ON "listings"
FOR SELECT
USING (
  "status" = 'published'
  OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')
);
--> statement-breakpoint
CREATE POLICY "listings_owner_write" ON "listings"
FOR ALL
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''))
WITH CHECK (
  "tenant_id" IS NOT NULL
  AND "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')
);
--> statement-breakpoint
CREATE POLICY "listing_versions_published_read" ON "listing_versions"
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM "listings" AS "l"
    WHERE "l"."id" = "listing_versions"."listing_id"
      AND (
        (
          "l"."status" = 'published'
          AND "listing_versions"."published_at" IS NOT NULL
        )
        OR "l"."tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')
      )
  )
);
--> statement-breakpoint
CREATE POLICY "listing_versions_owner_write" ON "listing_versions"
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM "listings" AS "l"
    WHERE "l"."id" = "listing_versions"."listing_id"
      AND "l"."tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM "listings" AS "l"
    WHERE "l"."id" = "listing_versions"."listing_id"
      AND "l"."tenant_id" IS NOT NULL
      AND "l"."tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')
  )
);
--> statement-breakpoint
CREATE POLICY "installs_tenant_isolation" ON "installs"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''))
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY "orders_tenant_isolation" ON "orders"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''))
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''));
--> statement-breakpoint
CREATE POLICY "reviews_tenant_isolation" ON "reviews"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''))
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), ''));
