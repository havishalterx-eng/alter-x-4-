DROP TABLE IF EXISTS "trigger_webhook_secrets";
--> statement-breakpoint
ALTER TABLE "trigger_versions"
ALTER COLUMN "workflow_version_id" TYPE uuid
USING CASE
  WHEN "workflow_version_id" IS NULL THEN NULL
  ELSE regexp_replace("workflow_version_id", '^wfv_', '')::uuid
END;
