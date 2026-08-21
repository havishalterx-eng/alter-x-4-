CREATE TABLE "audit_chain_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"last_entry_hash" bytea NOT NULL,
	"checked_events" bigint NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_chain_checkpoints_hash_length_check" CHECK (octet_length("last_entry_hash") = 32),
	CONSTRAINT "audit_chain_checkpoints_checked_events_check" CHECK ("checked_events" >= 0)
);
--> statement-breakpoint
-- Single global checkpoint row -- the chain itself has no tenant dimension
-- (audit_events spans all tenants), so there is exactly one chain to verify
-- and exactly one checkpoint to advance.
INSERT INTO "audit_chain_checkpoints" ("id", "last_entry_hash", "checked_events", "verified_at")
VALUES ('global', decode(repeat('00', 32), 'hex'), 0, '1970-01-01T00:00:00Z')
ON CONFLICT ("id") DO NOTHING;
