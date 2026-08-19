DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cost_ledger_provisioner') THEN
    EXECUTE 'REVOKE SELECT, INSERT ON "model_outcomes" FROM cost_ledger_provisioner';
  END IF;
END $$;
DROP TRIGGER IF EXISTS "model_outcomes_reject_tenant_id_change" ON "model_outcomes";
DROP TABLE IF EXISTS "model_outcomes";
