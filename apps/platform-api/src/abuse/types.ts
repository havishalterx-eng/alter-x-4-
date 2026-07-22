export interface AbuseCheckResult {
  allowed: boolean;
  reason: string;
  score?: number;
  limit?: number;
  remaining?: number;
}

export interface RateLimitInput {
  tenantId: string;
  userId: string;
  tenantRequestsInWindow: number;
  userRequestsInWindow: number;
}

export interface VerificationGateInput {
  emailVerified: boolean;
  phoneVerified: boolean;
  riskSignals?: number;
}

export interface PurchaseLimitInput {
  purchasesToday: number;
  amountToday: number;
  requestedAmount: number;
}

export interface RateLimitHookContract {
  check(input: RateLimitInput): Promise<AbuseCheckResult>;
}

export interface VerificationGateHookContract {
  check(input: VerificationGateInput): Promise<AbuseCheckResult>;
}

export interface PurchaseLimitHookContract {
  check(input: PurchaseLimitInput): Promise<AbuseCheckResult>;
}
