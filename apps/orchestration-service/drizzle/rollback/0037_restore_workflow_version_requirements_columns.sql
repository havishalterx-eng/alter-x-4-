-- Restores both columns as 0007 declared them: nullable jsonb, no default.
--
-- The data is not restored, because it cannot be: node_requirements is derived
-- from the compiled DAG's nodes by the Capability Resolver, and re-deriving it
-- for historical versions would call a live service per node for every row.
-- Every restored row reads NULL. Nothing reads these columns, so NULL is the
-- same observable state as the map that was there before.
ALTER TABLE workflow_versions ADD COLUMN node_requirements jsonb;
--> statement-breakpoint
ALTER TABLE workflow_versions ADD COLUMN policy_bindings jsonb;
