import type { EntitlementLimits } from "../entitlements/types";

export interface AdminTenantView {
  id: string;
  name: string;
  status: string;
  region: string;
  identity_org_ref: string | null;
  created_at: string;
}

export interface AdminTenantDetailView extends AdminTenantView {
  entitlement: {
    plan: string;
    access_state: string;
    limits: EntitlementLimits;
  };
}

export interface ProvisionTenantInput {
  name: string;
  identity_org_ref: string;
  region?: string;
  plan: string;
}

export interface SuspendTenantInput {
  reason: string;
}

export interface EntitlementOverrideInput {
  plan?: string;
  limits?: Partial<EntitlementLimits>;
  reason: string;
}
