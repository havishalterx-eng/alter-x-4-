import type { MiddlewareConsumer } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ConfigProvider } from "../entitlements/config-provider.interface";
import { StaffAuthMiddleware } from "../staff";
import { PurchaseLimitHook, RateLimitHook, VerificationGateHook } from "./abuse-hooks";
import { AbuseSignalController } from "./abuse-signal.controller";
import { AbuseSignalRepository } from "./abuse-signal.repository";
import { AbuseModule } from "./abuse.module";

const config: ConfigProvider = {
  getEntitlementDefaults: async () => { throw new Error("unused"); },
  getAbuseThresholds: async () => ({
    tenantRequestsPerMinute: 100,
    userRequestsPerMinute: 20,
    verificationScoreThreshold: 50,
    purchasesPerDay: 3,
    purchaseAmountPerDay: 200,
  }),
  getDunningConfig: async () => { throw new Error("unused"); },
};

type FactoryProvider = { provide: unknown; useFactory: (...args: unknown[]) => unknown };

function factory(token: unknown): (...args: unknown[]) => unknown {
  const providers = Reflect.getMetadata("providers", AbuseModule) as FactoryProvider[];
  const provider = providers.find((candidate) => candidate.provide === token);
  if (!provider) throw new Error("provider factory missing");
  return provider.useFactory;
}

describe("AbuseModule", () => {
  it("wires hooks, database sources, and staff middleware", async () => {
    expect(factory(RateLimitHook)(config)).toBeInstanceOf(RateLimitHook);
    expect(factory(VerificationGateHook)(config)).toBeInstanceOf(VerificationGateHook);
    expect(factory(PurchaseLimitHook)(config)).toBeInstanceOf(PurchaseLimitHook);

    const oldPlatform = process.env.OPERATIONS_PLATFORM_DATABASE_URL;
    const oldMarketplace = process.env.OPERATIONS_MARKETPLACE_DATABASE_URL;
    delete process.env.OPERATIONS_PLATFORM_DATABASE_URL;
    delete process.env.OPERATIONS_MARKETPLACE_DATABASE_URL;
    const withoutSources = factory(AbuseSignalRepository)() as AbuseSignalRepository;
    process.env.OPERATIONS_PLATFORM_DATABASE_URL = "postgres://platform";
    process.env.OPERATIONS_MARKETPLACE_DATABASE_URL = "postgres://marketplace";
    const withSources = factory(AbuseSignalRepository)() as AbuseSignalRepository;
    await Promise.all([withoutSources.onModuleDestroy(), withSources.onModuleDestroy()]);
    if (oldPlatform === undefined) delete process.env.OPERATIONS_PLATFORM_DATABASE_URL;
    else process.env.OPERATIONS_PLATFORM_DATABASE_URL = oldPlatform;
    if (oldMarketplace === undefined) delete process.env.OPERATIONS_MARKETPLACE_DATABASE_URL;
    else process.env.OPERATIONS_MARKETPLACE_DATABASE_URL = oldMarketplace;

    const forRoutes = vi.fn();
    const consumer = {
      apply: vi.fn().mockReturnValue({ forRoutes }),
    } as unknown as MiddlewareConsumer;
    new AbuseModule().configure(consumer);
    expect(consumer.apply).toHaveBeenCalledWith(StaffAuthMiddleware);
    expect(forRoutes).toHaveBeenCalledWith(AbuseSignalController);
  });
});
