CREATE TABLE IF NOT EXISTS "workspace_connector_configs" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "workspace_id" uuid NOT NULL,
  "connector" text NOT NULL,
  "config_json" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_connector_configs_tenant_workspace_fk"
    FOREIGN KEY ("tenant_id", "workspace_id")
    REFERENCES "workspaces"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "workspace_connector_configs_tenant_workspace_connector_unique"
    UNIQUE ("tenant_id", "workspace_id", "connector")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_connector_configs_tenant_workspace_idx"
ON "workspace_connector_configs" ("tenant_id", "workspace_id");
--> statement-breakpoint
DROP TRIGGER IF EXISTS workspace_connector_configs_prevent_tenant_id_update
ON "workspace_connector_configs";
--> statement-breakpoint
CREATE TRIGGER workspace_connector_configs_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "workspace_connector_configs"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "workspace_connector_configs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspace_connector_configs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS workspace_connector_configs_tenant_isolation
ON "workspace_connector_configs";
--> statement-breakpoint
CREATE POLICY workspace_connector_configs_tenant_isolation
ON "workspace_connector_configs"
USING (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);
