DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "workflows" WHERE "status" = 'paused') THEN
    RAISE EXCEPTION 'cannot remove paused workflow status while paused rows exist';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "workflows" DROP CONSTRAINT "workflows_status_check";
--> statement-breakpoint
ALTER TABLE "workflows"
  ADD CONSTRAINT "workflows_status_check"
  CHECK ("status" IN ('draft', 'active', 'archived'));
