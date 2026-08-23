-- Pinned to SCHEMA public (not the caller's default search_path target):
-- marketplace/publisher/registry's integration specs each run this same
-- migration against their own freshly created, uniquely named schema.
-- CREATE EXTENSION is once-per-database -- without an explicit target,
-- whichever spec's migration runs first claims pg_trgm into ITS OWN
-- schema, and every other spec's later IF NOT EXISTS silently no-ops,
-- leaving gin_trgm_ops unresolvable on a search_path that never included
-- wherever the extension actually landed ("operator class gin_trgm_ops
-- does not exist for access method gin"). Pinning to public -- present in
-- every database, never dropped by a spec's per-test schema cleanup --
-- gives every caller the same, deterministic answer for where it lives.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
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
