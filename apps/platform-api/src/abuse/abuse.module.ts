import { Module } from "@nestjs/common";
import { CONFIG_PROVIDER } from "../entitlements/config-provider.interface";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { PurchaseLimitHook, RateLimitHook, VerificationGateHook } from "./abuse-hooks";

@Module({
  imports: [EntitlementsModule],
  providers: [
    {
      provide: RateLimitHook,
      inject: [CONFIG_PROVIDER],
      useFactory: (configProvider: ConstructorParameters<typeof RateLimitHook>[0]) =>
        new RateLimitHook(configProvider),
    },
    {
      provide: VerificationGateHook,
      inject: [CONFIG_PROVIDER],
      useFactory: (
        configProvider: ConstructorParameters<typeof VerificationGateHook>[0],
      ) => new VerificationGateHook(configProvider),
    },
    {
      provide: PurchaseLimitHook,
      inject: [CONFIG_PROVIDER],
      useFactory: (
        configProvider: ConstructorParameters<typeof PurchaseLimitHook>[0],
      ) => new PurchaseLimitHook(configProvider),
    },
  ],
  exports: [RateLimitHook, VerificationGateHook, PurchaseLimitHook],
})
export class AbuseModule {}
