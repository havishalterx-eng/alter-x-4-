CREATE TABLE IF NOT EXISTS "discovery_recommendations" (
  "id" text PRIMARY KEY CHECK ("id" ~ '^rec_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "workspace_id" uuid NOT NULL,
  "problem_statement" text NOT NULL,
  "evidence_json" jsonb NOT NULL,
  "estimated_value" integer NOT NULL CHECK ("estimated_value" >= 0),
  "estimated_effort" integer NOT NULL CHECK ("estimated_effort" >= 1 AND "estimated_effort" <= 3),
  "required_integrations_json" jsonb NOT NULL,
  "risk_level" text NOT NULL CHECK ("risk_level" IN ('low', 'medium', 'high')),
  "confidence" numeric(3,2) NOT NULL CHECK ("confidence" >= 0 AND "confidence" <= 1),
  "status" text NOT NULL CHECK ("status" IN ('suggested', 'accepted', 'dismissed')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "discovery_recommendations_tenant_id_id_unique" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "discovery_recommendations_tenant_workspace_problem_unique"
    UNIQUE ("tenant_id", "workspace_id", "problem_statement"),
  CONSTRAINT "discovery_recommendations_tenant_workspace_fk"
    FOREIGN KEY ("tenant_id", "workspace_id")
    REFERENCES "workspaces"("tenant_id", "id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_recommendations_tenant_workspace_rank_idx"
ON "discovery_recommendations" ("tenant_id", "workspace_id", "estimated_value" DESC, "confidence" DESC, "created_at" DESC, "id" DESC);
--> statement-breakpoint
DROP TRIGGER IF EXISTS discovery_recommendations_prevent_tenant_id_update ON "discovery_recommendations";
--> statement-breakpoint
CREATE TRIGGER discovery_recommendations_prevent_tenant_id_update
BEFORE UPDATE OF "tenant_id" ON "discovery_recommendations"
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_id_update();
--> statement-breakpoint
ALTER TABLE "discovery_recommendations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "discovery_recommendations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS discovery_recommendations_tenant_isolation ON "discovery_recommendations";
--> statement-breakpoint
CREATE POLICY discovery_recommendations_tenant_isolation ON "discovery_recommendations"
USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
