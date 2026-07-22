import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ConfigProvider } from "../entitlements/config-provider.interface";
import {
  PurchaseLimitHook,
  RateLimitHook,
  VerificationGateHook,
} from "./abuse-hooks";

const config: ConfigProvider = {
  getEntitlementDefaults: async () => {
    throw new Error("unused");
  },
  getAbuseThresholds: async () => ({
    tenantRequestsPerMinute: 100,
    userRequestsPerMinute: 20,
    verificationScoreThreshold: 50,
    purchasesPerDay: 3,
    purchaseAmountPerDay: 200,
  }),
};

describe("abuse hooks", () => {
  it("rate hook allows and denies using config thresholds", async () => {
    const hook = new RateLimitHook(config);
    await expect(
      hook.check({
        tenantId: "tenant-1",
        userId: "user-1",
        tenantRequestsInWindow: 10,
        userRequestsInWindow: 5,
      }),
    ).resolves.toMatchObject({ allowed: true, reason: "RATE_LIMIT_AVAILABLE" });
    await expect(
      hook.check({
        tenantId: "tenant-1",
        userId: "user-1",
        tenantRequestsInWindow: 100,
        userRequestsInWindow: 5,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "TENANT_RATE_LIMIT_REACHED",
    });
    await expect(
      hook.check({
        tenantId: "tenant-1",
        userId: "user-1",
        tenantRequestsInWindow: 10,
        userRequestsInWindow: 20,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "USER_RATE_LIMIT_REACHED",
    });
  });

  it("verification hook computes score and can deny", async () => {
    const hook = new VerificationGateHook(config);
    await expect(
      hook.check({ emailVerified: true, phoneVerified: true }),
    ).resolves.toMatchObject({
      allowed: true,
      reason: "VERIFICATION_SUFFICIENT",
      score: 70,
    });
    await expect(
      hook.check({ emailVerified: true, phoneVerified: false, riskSignals: 5 }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "VERIFICATION_REQUIRED",
      score: 30,
    });
  });

  it("purchase hook enforces count and amount limits", async () => {
    const hook = new PurchaseLimitHook(config);
    await expect(
      hook.check({ purchasesToday: 1, amountToday: 20, requestedAmount: 30 }),
    ).resolves.toMatchObject({
      allowed: true,
      reason: "PURCHASE_LIMIT_AVAILABLE",
    });
    await expect(
      hook.check({ purchasesToday: 3, amountToday: 20, requestedAmount: 30 }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "PURCHASE_COUNT_LIMIT_REACHED",
    });
    await expect(
      hook.check({ purchasesToday: 1, amountToday: 190, requestedAmount: 30 }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "PURCHASE_AMOUNT_LIMIT_EXCEEDED",
    });
  });

  it("uses finite emergency thresholds when config is down", async () => {
    const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const unavailable: ConfigProvider = {
      ...config,
      getAbuseThresholds: async () => {
        throw new Error("down");
      },
    };
    await expect(
      new RateLimitHook(unavailable).check({
        tenantId: "tenant-1",
        userId: "user-1",
        tenantRequestsInWindow: 120,
        userRequestsInWindow: 0,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "TENANT_RATE_LIMIT_REACHED",
    });
    expect(error).toHaveBeenCalledWith(
      "Abuse ConfigProvider unavailable; applying finite emergency thresholds",
      expect.stringContaining("down"),
    );
    error.mockRestore();
  });
});
