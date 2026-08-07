DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "deployments" WHERE "status" = 'suspended') THEN
    RAISE EXCEPTION 'cannot remove suspended deployment status while suspended rows exist';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_status_check";
--> statement-breakpoint
ALTER TABLE "deployments"
  ADD CONSTRAINT "deployments_status_check"
  CHECK ("status" IN ('pending', 'active', 'failed', 'rolled_back'));
