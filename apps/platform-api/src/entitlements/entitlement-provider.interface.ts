import type {
  EffectiveEntitlement,
  EntitlementAccessState,
  EntitlementLimitKey,
  EntitlementLimits,
  LimitCheckResult,
} from "./types";
import type { PoolClient } from "pg";

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
    transactionClient?: PoolClient,
    options?: {
      accessState?: EntitlementAccessState;
      limits?: Partial<EntitlementLimits>;
    },
  ): Promise<EffectiveEntitlement>;
}
