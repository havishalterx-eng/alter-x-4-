ALTER TABLE "runs"
ADD COLUMN "workflow_version_id" text;
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workflow_version_tenant_fk" FOREIGN KEY ("tenant_id", "workflow_version_id") REFERENCES "workflow_versions"("tenant_id", "id");
