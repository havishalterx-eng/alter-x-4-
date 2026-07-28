CREATE TABLE "run_stream_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "run_id" text NOT NULL,
  "seq" integer NOT NULL,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "run_stream_events_tenant_run_seq_unique" UNIQUE ("tenant_id", "run_id", "seq"),
  CONSTRAINT "run_stream_events_run_tenant_fk" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "runs"("tenant_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER "run_stream_events_reject_tenant_id_change" BEFORE UPDATE ON "run_stream_events" FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "run_stream_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "run_stream_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "run_stream_events_tenant_context_isolation" ON "run_stream_events" USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_run_stream_events_tenant_run_seq" ON "run_stream_events" ("tenant_id", "run_id", "seq");
