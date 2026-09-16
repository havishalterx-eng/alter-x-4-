-- Reverses 0003_search_indexes.sql: the six search indexes and the two
-- generated tsvector columns, dropped in the reverse of the order they were
-- created.
--
-- pg_trgm is deliberately NOT dropped. 0003 pins it to SCHEMA public because
-- the marketplace, publisher, registry and search specs each migrate their own
-- private schema concurrently and all of them resolve gin_trgm_ops from public;
-- CREATE EXTENSION is once-per-database, so dropping it here would break every
-- other caller that is mid-run, and leave a database whose extension state
-- depends on which spec finished last. An extension nothing else creates is
-- also harmless to leave behind -- unlike a table, it holds no rows.
DROP INDEX IF EXISTS "tool_manifests_name_trgm_idx";
DROP INDEX IF EXISTS "listings_name_trgm_idx";
DROP INDEX IF EXISTS "tool_manifests_search_document_idx";
DROP INDEX IF EXISTS "listings_search_document_idx";
ALTER TABLE "tool_manifests" DROP COLUMN IF EXISTS "search_document";
ALTER TABLE "listings" DROP COLUMN IF EXISTS "search_document";
