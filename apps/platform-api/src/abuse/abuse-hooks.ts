import type { ConfigProvider } from "../entitlements/config-provider.interface";
import {
  EMERGENCY_ABUSE_THRESHOLDS,
  type AbuseThresholds,
} from "../entitlements/types";
import type {
  AbuseCheckResult,
  PurchaseLimitInput,
  PurchaseLimitHookContract,
  RateLimitInput,
  RateLimitHookContract,
  VerificationGateInput,
  VerificationGateHookContract,
} from "./types";

abstract class ConfiguredAbuseHook {
  private readonly logger = new Logger(ConfiguredAbuseHook.name);

  constructor(protected readonly configProvider: ConfigProvider) {}

  protected async thresholds(): Promise<AbuseThresholds> {
    try {
      return await this.configProvider.getAbuseThresholds();
    } catch (error) {
      this.logger.error(
        "Abuse ConfigProvider unavailable; applying finite emergency thresholds",
        error instanceof Error ? error.stack : String(error),
      );
      return { ...EMERGENCY_ABUSE_THRESHOLDS };
    }
  }
}

export class RateLimitHook
  extends ConfiguredAbuseHook
  implements RateLimitHookContract
{
  async check(input: RateLimitInput): Promise<AbuseCheckResult> {
    const thresholds = await this.thresholds();
    if (input.tenantRequestsInWindow >= thresholds.tenantRequestsPerMinute) {
      return {
        allowed: false,
        reason: "TENANT_RATE_LIMIT_REACHED",
        limit: thresholds.tenantRequestsPerMinute,
        remaining: 0,
      };
    }
    if (input.userRequestsInWindow >= thresholds.userRequestsPerMinute) {
      return {
        allowed: false,
        reason: "USER_RATE_LIMIT_REACHED",
        limit: thresholds.userRequestsPerMinute,
        remaining: 0,
      };
    }
    return {
      allowed: true,
      reason: "RATE_LIMIT_AVAILABLE",
      remaining: Math.min(
        thresholds.tenantRequestsPerMinute - input.tenantRequestsInWindow,
        thresholds.userRequestsPerMinute - input.userRequestsInWindow,
      ),
    };
  }
}

export class VerificationGateHook
  extends ConfiguredAbuseHook
  implements VerificationGateHookContract
{
  async check(input: VerificationGateInput): Promise<AbuseCheckResult> {
    const thresholds = await this.thresholds();
    const score =
      (input.emailVerified ? 35 : 0) +
      (input.phoneVerified ? 35 : 0) -
      Math.max(0, input.riskSignals ?? 0);
    return score >= thresholds.verificationScoreThreshold
      ? { allowed: true, reason: "VERIFICATION_SUFFICIENT", score }
      : { allowed: false, reason: "VERIFICATION_REQUIRED", score };
  }
}

export class PurchaseLimitHook
  extends ConfiguredAbuseHook
  implements PurchaseLimitHookContract
{
  async check(input: PurchaseLimitInput): Promise<AbuseCheckResult> {
    const thresholds = await this.thresholds();
    if (input.purchasesToday >= thresholds.purchasesPerDay) {
      return {
        allowed: false,
        reason: "PURCHASE_COUNT_LIMIT_REACHED",
        limit: thresholds.purchasesPerDay,
        remaining: 0,
      };
    }
    if (input.amountToday + input.requestedAmount > thresholds.purchaseAmountPerDay) {
      return {
        allowed: false,
        reason: "PURCHASE_AMOUNT_LIMIT_EXCEEDED",
        limit: thresholds.purchaseAmountPerDay,
        remaining: Math.max(0, thresholds.purchaseAmountPerDay - input.amountToday),
      };
    }
    return {
      allowed: true,
      reason: "PURCHASE_LIMIT_AVAILABLE",
      remaining: thresholds.purchaseAmountPerDay - input.amountToday - input.requestedAmount,
    };
  }
}
import { Logger } from "@nestjs/common";
