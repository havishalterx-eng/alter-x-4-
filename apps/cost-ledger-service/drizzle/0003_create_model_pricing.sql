CREATE TABLE "model_pricing" (
  "provider" text NOT NULL,
  "resource" text NOT NULL,
  "unit_cost_minor" bigint NOT NULL,
  "currency" text DEFAULT 'INR' NOT NULL,
  "effective_from" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "model_pricing_pk" PRIMARY KEY ("provider", "resource"),
  CONSTRAINT "model_pricing_unit_cost_minor_check" CHECK ("unit_cost_minor" >= 0)
);

ALTER TABLE "model_pricing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "model_pricing" FORCE ROW LEVEL SECURITY;

CREATE POLICY "Provisioner may read and manage model pricing globally"
  ON "model_pricing"
  TO "cost_ledger_provisioner"
  USING (true)
  WITH CHECK (true);

-- cost_ledger_provisioner is BYPASSRLS (created in 0001), so the policy
-- above is a documentation/defense-in-depth statement, not what actually
-- authorizes this role -- table-level GRANT is the real gate, same as
-- every other provisioner-managed table in this service.
GRANT SELECT, INSERT, UPDATE, DELETE ON "model_pricing" TO cost_ledger_provisioner;
