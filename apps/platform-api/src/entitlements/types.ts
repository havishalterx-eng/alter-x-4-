export interface EntitlementLimits {
  maxWorkflows: number;
  maxProjects: number;
  maxRunsPerDay: number;
  maxConcurrentRuns: number;
  maxSandboxMinutesPerMonth: number;
  maxAdsStorageMb: number;
  maxIntegrations: number;
}

export type EntitlementLimitKey = keyof EntitlementLimits;
export const ENTITLEMENT_LIMIT_KEYS: readonly EntitlementLimitKey[] = [
  "maxWorkflows",
  "maxProjects",
  "maxRunsPerDay",
  "maxConcurrentRuns",
  "maxSandboxMinutesPerMonth",
  "maxAdsStorageMb",
  "maxIntegrations",
];
export type EntitlementAccessState =
  | "active"
  | "grace"
  | "limited"
  | "suspended";

export interface DunningConfig {
  gracePeriodSeconds: number;
  suspensionThresholdSeconds: number;
  limitedStateLimits: EntitlementLimits;
}

export interface AbuseThresholds {
  tenantRequestsPerMinute: number;
  userRequestsPerMinute: number;
  verificationScoreThreshold: number;
  purchasesPerDay: number;
  purchaseAmountPerDay: number;
}

export interface EffectiveEntitlement {
  tenantId: string;
  plan: string;
  limits: EntitlementLimits;
  accessState: EntitlementAccessState;
  source: "config" | "tenant-override" | "dunning" | "emergency-fallback";
}

export type EntitlementReasonCode =
  | "LIMIT_AVAILABLE"
  | "LIMIT_REACHED"
  | "LIMIT_EXCEEDED";

export interface LimitCheckResult {
  allowed: boolean;
  reason: EntitlementReasonCode;
  limit: number;
  currentUsage: number;
  remaining: number;
}

export const EMERGENCY_FREE_LIMITS: Readonly<EntitlementLimits> = Object.freeze({
  maxWorkflows: 3,
  maxProjects: 1,
  maxRunsPerDay: 10,
  maxConcurrentRuns: 1,
  maxSandboxMinutesPerMonth: 30,
  maxAdsStorageMb: 500,
  maxIntegrations: 3,
});

export const EMERGENCY_ABUSE_THRESHOLDS: Readonly<AbuseThresholds> =
  Object.freeze({
    tenantRequestsPerMinute: 120,
    userRequestsPerMinute: 60,
    verificationScoreThreshold: 50,
    purchasesPerDay: 10,
    purchaseAmountPerDay: 1_000,
  });
