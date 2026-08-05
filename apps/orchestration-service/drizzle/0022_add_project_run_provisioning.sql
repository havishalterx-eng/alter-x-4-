ALTER TABLE "runs" ADD COLUMN "project_id" text;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "provisioning_session_id" text;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "provisioning_cycle_id" text;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "provisioning_template_id" text;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "provisioning_closed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_parent_kind_check";
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_parent_kind_check"
  CHECK ("parent_kind" IN ('workflow', 'project'));
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_tenant_fk"
  FOREIGN KEY ("tenant_id", "project_id") REFERENCES "projects"("tenant_id", "id");
--> statement-breakpoint
CREATE INDEX "idx_runs_tenant_project" ON "runs" ("tenant_id", "project_id");
