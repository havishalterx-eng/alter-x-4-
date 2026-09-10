-- Recovery's "replan" strategy needs the TaskSkeleton the version was compiled
-- from. Only a SHA-256 of it was kept (compile_metadata.source_skeleton_hash),
-- which is one-way, so there was nothing to send and #replan sent the compiled
-- DAG instead -- a different shape that the planner rejects.
--
-- Nullable, and no backfill: the hash cannot be reversed, so versions compiled
-- before this migration have no skeleton and never will. They replan only once
-- they are next recompiled. Recovery reports that honestly rather than failing.
ALTER TABLE workflow_versions ADD COLUMN task_skeleton jsonb;
