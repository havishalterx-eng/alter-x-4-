ALTER TABLE "runs"
  ADD COLUMN "deadline_at" timestamptz NOT NULL
  DEFAULT (clock_timestamp() + interval '24 hours');

CREATE INDEX "idx_runs_tenant_deadline" ON "runs" ("tenant_id", "deadline_at");
