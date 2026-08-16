CREATE TABLE "run_dispatch_queue" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "run_id" text NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "compiled_dag" jsonb NOT NULL,
  "already_running" boolean DEFAULT false NOT NULL,
  "available_at" timestamptz DEFAULT clock_timestamp() NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamptz,
  "attempts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "run_dispatch_queue_tenant_run_unique" UNIQUE ("tenant_id", "run_id"),
  CONSTRAINT "run_dispatch_queue_run_tenant_fk"
    FOREIGN KEY ("tenant_id", "run_id") REFERENCES "runs"("tenant_id", "id")
);
--> statement-breakpoint
CREATE TRIGGER "run_dispatch_queue_reject_tenant_id_change"
BEFORE UPDATE ON "run_dispatch_queue"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "run_dispatch_queue" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "run_dispatch_queue" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "run_dispatch_queue_tenant_context_isolation" ON "run_dispatch_queue"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_run_dispatch_queue_claim"
ON "run_dispatch_queue" ("tenant_id", "priority" DESC, "available_at", "created_at", "id");
