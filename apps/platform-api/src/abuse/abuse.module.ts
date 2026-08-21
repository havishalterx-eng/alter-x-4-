import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { AdminAuditModule } from "../admin-audit";
import { CONFIG_PROVIDER } from "../entitlements/config-provider.interface";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { StaffAuthMiddleware, StaffModule } from "../staff";
import { sharedPool } from "../db/shared-pool";
import { PurchaseLimitHook, RateLimitHook, VerificationGateHook } from "./abuse-hooks";
import { AbuseSignalController } from "./abuse-signal.controller";
import { AbuseSignalExceptionFilter } from "./abuse-signal-exception.filter";
import { AbuseSignalRepository } from "./abuse-signal.repository";
import { AbuseSignalService } from "./abuse-signal.service";

@Module({
  imports: [AdminAuditModule, EntitlementsModule, StaffModule],
  controllers: [AbuseSignalController],
  providers: [
    {
      provide: RateLimitHook,
      inject: [CONFIG_PROVIDER],
      useFactory: (configProvider: ConstructorParameters<typeof RateLimitHook>[0]) =>
        new RateLimitHook(configProvider),
    },
    {
      provide: AbuseSignalRepository,
      useFactory: () => new AbuseSignalRepository(
        sharedPool(process.env.DATABASE_URL),
        process.env.OPERATIONS_PLATFORM_DATABASE_URL
          ? sharedPool(process.env.OPERATIONS_PLATFORM_DATABASE_URL)
          : undefined,
        process.env.OPERATIONS_MARKETPLACE_DATABASE_URL
          ? sharedPool(process.env.OPERATIONS_MARKETPLACE_DATABASE_URL)
          : undefined,
        false,
      ),
    },
    AbuseSignalService,
    AbuseSignalExceptionFilter,
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
export class AbuseModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(StaffAuthMiddleware).forRoutes(AbuseSignalController);
  }
}
