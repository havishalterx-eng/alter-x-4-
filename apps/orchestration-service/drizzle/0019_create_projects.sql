CREATE TABLE "projects" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "projects_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "projects_status_check" CHECK ("status" IN ('draft', 'active', 'archived'))
);
--> statement-breakpoint
CREATE TRIGGER "projects_reject_tenant_id_change"
BEFORE UPDATE ON "projects"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "projects_tenant_context_isolation" ON "projects"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "deployments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "project_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "deployments_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "deployments_project_tenant_fk" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "projects"("tenant_id", "id"),
  CONSTRAINT "deployments_status_check" CHECK ("status" IN ('pending', 'active', 'failed'))
);
--> statement-breakpoint
CREATE TRIGGER "deployments_reject_tenant_id_change"
BEFORE UPDATE ON "deployments"
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change();
--> statement-breakpoint
ALTER TABLE "deployments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deployments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "deployments_tenant_context_isolation" ON "deployments"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "idx_deployments_project" ON "deployments" ("tenant_id", "project_id");
