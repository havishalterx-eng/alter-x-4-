import type { AbuseThresholds, EntitlementLimits } from "./types";

export const CONFIG_PROVIDER = Symbol("CONFIG_PROVIDER");

export interface ConfigProvider {
  getEntitlementDefaults(plan: string): Promise<EntitlementLimits>;
  getAbuseThresholds(): Promise<AbuseThresholds>;
}
