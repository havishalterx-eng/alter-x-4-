-- node_requirements and policy_bindings were write-only for the life of the
-- table. The only references anywhere were the two compiler INSERTs, the
-- template-variables INSERT...SELECT that copied them forward, and the Drizzle
-- schema. Nothing ever selected either column.
--
-- policy_bindings was never more than '{}' on either compile path. Populating
-- node_requirements cost one Capability Resolver round trip per node on every
-- compile, for a value no reader has ever asked for -- and it was populated on
-- the skeleton path only, so an architecture-compiled version stored '{}' and
-- a skeleton-compiled one stored a map, with no way for a reader to tell the
-- two apart (#117).
--
-- The run-time path is untouched and stays the source of truth: NodeExecService
-- and RecoveryDispatchService each resolve requirements fresh, per node, at the
-- moment they need them.
ALTER TABLE workflow_versions DROP COLUMN node_requirements;
--> statement-breakpoint
ALTER TABLE workflow_versions DROP COLUMN policy_bindings;
