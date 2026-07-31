DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cost_ledger_provisioner') THEN
    EXECUTE 'REVOKE SELECT, INSERT, DELETE ON "cost_events" FROM cost_ledger_provisioner';
    EXECUTE 'REVOKE SELECT, INSERT, UPDATE, DELETE ON "billing_rollups" FROM cost_ledger_provisioner';
    EXECUTE 'DROP OWNED BY cost_ledger_provisioner';
    EXECUTE 'DROP ROLE cost_ledger_provisioner';
  END IF;
END $$;
DROP TRIGGER IF EXISTS "billing_rollups_reject_tenant_reassignment" ON "billing_rollups";
DROP TABLE IF EXISTS "billing_rollups";
DROP FUNCTION IF EXISTS reject_billing_rollup_tenant_reassignment();
