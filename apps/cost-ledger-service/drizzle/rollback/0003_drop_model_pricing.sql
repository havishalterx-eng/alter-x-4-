DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cost_ledger_provisioner') THEN
    EXECUTE 'REVOKE SELECT, INSERT, UPDATE, DELETE ON "model_pricing" FROM cost_ledger_provisioner';
  END IF;
END $$;
DROP TABLE "model_pricing";
