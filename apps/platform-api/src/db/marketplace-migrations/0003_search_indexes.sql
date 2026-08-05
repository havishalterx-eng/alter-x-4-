CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "search_document" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("description", '')), 'B')
) STORED;
--> statement-breakpoint
ALTER TABLE "tool_manifests" ADD COLUMN IF NOT EXISTS "search_document" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("description", '')), 'B')
) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_search_document_idx" ON "listings" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_manifests_search_document_idx" ON "tool_manifests" USING gin ("search_document");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_name_trgm_idx" ON "listings" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_manifests_name_trgm_idx" ON "tool_manifests" USING gin ("name" gin_trgm_ops);
