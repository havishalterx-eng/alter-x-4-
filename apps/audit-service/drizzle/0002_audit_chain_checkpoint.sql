-- Single global checkpoint row -- the chain itself has no tenant dimension
-- (audit_events spans all tenants), so there is exactly one chain to verify
-- and exactly one checkpoint to advance. No seed row: absence means "never
-- verified yet", which AuditService.verifyChainIncremental already treats
-- as equivalent to genesis -- a placeholder row here would just be a second,
-- redundant way of saying the same thing, inconsistent with the in-memory
-- mock (which also starts with no checkpoint).
CREATE TABLE "audit_chain_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"last_entry_hash" bytea NOT NULL,
	"checked_events" bigint NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_chain_checkpoints_hash_length_check" CHECK (octet_length("last_entry_hash") = 32),
	CONSTRAINT "audit_chain_checkpoints_checked_events_check" CHECK ("checked_events" >= 0)
);
