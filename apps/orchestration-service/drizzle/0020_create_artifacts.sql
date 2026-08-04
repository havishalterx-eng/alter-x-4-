CREATE TABLE "artifacts" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "run_id" text NOT NULL,
  "storage_reference" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "artifacts_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "artifacts_run_tenant_fk" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "runs"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "artifacts_size_bytes_nonnegative" CHECK ("size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TRIGGER "artifacts_reject_tenant_id_change"
BEFORE UPDATE ON "artifacts"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "artifacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "artifacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "artifacts_tenant_context_isolation" ON "artifacts"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_artifacts_tenant_run_created" ON "artifacts" ("tenant_id", "run_id", "created_at" DESC);
