import type {
  EffectiveEntitlement,
  EntitlementLimitKey,
  LimitCheckResult,
} from "./types";

export const ENTITLEMENT_PROVIDER = Symbol("ENTITLEMENT_PROVIDER");

export interface EntitlementProvider {
  getEffectiveEntitlement(tenantId: string): Promise<EffectiveEntitlement>;
  checkLimit(
    tenantId: string,
    limitKey: EntitlementLimitKey,
    currentUsage: number,
  ): Promise<LimitCheckResult>;
  createEntitlement(
    tenantId: string,
    plan: string,
  ): Promise<EffectiveEntitlement>;
}
