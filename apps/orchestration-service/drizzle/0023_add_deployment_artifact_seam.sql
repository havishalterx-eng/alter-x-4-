ALTER TABLE "deployments" ADD COLUMN "artifact_id" text;
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "destination_reference" text;
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "updated_at" timestamptz DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "deployments"
  ADD CONSTRAINT "deployments_artifact_tenant_fk"
  FOREIGN KEY ("tenant_id", "artifact_id")
  REFERENCES "artifacts"("tenant_id", "id");
--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_status_check";
--> statement-breakpoint
ALTER TABLE "deployments"
  ADD CONSTRAINT "deployments_status_check"
  CHECK ("status" IN ('pending', 'active', 'failed', 'rolled_back'));
--> statement-breakpoint
ALTER TABLE "deployments"
  ADD CONSTRAINT "deployments_active_artifact_check"
  CHECK (
    "status" <> 'active'
    OR ("artifact_id" IS NOT NULL AND "destination_reference" IS NOT NULL)
  ) NOT VALID;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "deployments"
    WHERE "status" = 'active'
    GROUP BY "tenant_id", "project_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'cannot enforce one active deployment per project while duplicate active rows exist';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_deployments_tenant_project_active"
  ON "deployments" ("tenant_id", "project_id")
  WHERE "status" = 'active';
