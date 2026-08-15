ALTER TABLE "runs" ADD COLUMN "triggering_event_id" text;

ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_event_id_unique" UNIQUE ("tenant_id", "event_id");

ALTER TABLE "runs"
  ADD CONSTRAINT "runs_triggering_event_tenant_fk"
  FOREIGN KEY ("tenant_id", "triggering_event_id")
  REFERENCES "events" ("tenant_id", "event_id");

CREATE INDEX "idx_runs_triggering_event" ON "runs" ("tenant_id", "triggering_event_id");