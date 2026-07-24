CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"tenant_pseudonym" text,
	"actor_type" text NOT NULL,
	"actor_ref" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_ref" text,
	"result" text NOT NULL,
	"reason_code" text,
	"context" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"prev_hash" bytea NOT NULL,
	"entry_hash" bytea NOT NULL,
	CONSTRAINT "audit_events_actor_type_check" CHECK ("actor_type" IN ('user', 'service', 'admin', 'support', 'system')),
	CONSTRAINT "audit_events_result_check" CHECK ("result" IN ('success', 'denied', 'error')),
	CONSTRAINT "audit_events_hash_length_check" CHECK (octet_length("prev_hash") = 32 AND octet_length("entry_hash") = 32),
	CONSTRAINT "audit_events_support_reason_check" CHECK (
		NOT (
			"actor_type" = 'support'
			OR lower("action") LIKE 'support.access%'
			OR position('break_glass' IN lower("action")) > 0
			OR position('break-glass' IN lower("action")) > 0
		)
		OR nullif(btrim("reason_code"), '') IS NOT NULL
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_entry_hash_unique" ON "audit_events" USING btree ("entry_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_prev_hash_unique" ON "audit_events" USING btree ("prev_hash");
--> statement-breakpoint
CREATE INDEX "audit_events_tenant_occurred_at_idx" ON "audit_events" USING btree ("tenant_id", "occurred_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'audit_events is immutable'
    USING ERRCODE = '55000';
END;
$function$;
--> statement-breakpoint
CREATE TRIGGER "audit_events_immutable"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_events_internal_access" ON "audit_events"
USING (
  current_user = 'audit_service'
  AND current_setting('app.audit_internal', true) = 'on'
)
WITH CHECK (
  current_user = 'audit_service'
  AND current_setting('app.audit_internal', true) = 'on'
);
