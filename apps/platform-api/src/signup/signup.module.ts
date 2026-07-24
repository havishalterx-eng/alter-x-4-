import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { Pool } from "pg";
import {
  ENTITLEMENT_PROVIDER,
  type EntitlementProvider,
} from "../entitlements/entitlement-provider.interface";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { IDENTITY_PROVIDER, IdentityModule } from "../identity/identity.module";
import type { IdentityProvider } from "../identity/identity-provider.interface";
import { IdentityService } from "../identity/identity.service";
import { IdentityBrokerModule } from "../identity-broker/identity-broker.module";
import { IdentityBrokerService } from "../identity-broker/identity-broker.service";
import {
  ProcessLocalSignupIdempotencyStore,
  type IdempotencyStore,
} from "./idempotency-store";
import { PlatformDb } from "./platform-db";
import { SignupController } from "./signup.controller";
import { SignupActorContextMiddleware } from "./signup-actor-context.middleware";
import { SignupService } from "./signup.service";

@Module({
  imports: [IdentityModule, IdentityBrokerModule, EntitlementsModule],
  controllers: [SignupController],
  providers: [
    {
      provide: PlatformDb,
      useFactory: () =>
        new PlatformDb(new Pool({ connectionString: process.env.DATABASE_URL })),
    },
    SignupActorContextMiddleware,
    {
      provide: ProcessLocalSignupIdempotencyStore,
      useFactory: () => new ProcessLocalSignupIdempotencyStore(),
    },
    {
      provide: SignupService,
      inject: [
        IDENTITY_PROVIDER,
        IdentityService,
        IdentityBrokerService,
        ENTITLEMENT_PROVIDER,
        PlatformDb,
        ProcessLocalSignupIdempotencyStore,
      ],
      useFactory: (
        identityProvider: IdentityProvider,
        identityService: IdentityService,
        identityBroker: IdentityBrokerService,
        entitlementProvider: EntitlementProvider,
        persistence: PlatformDb,
        idempotency: IdempotencyStore,
      ) =>
        new SignupService(
          identityProvider,
          identityService,
          identityBroker,
          entitlementProvider,
          persistence,
          idempotency,
        ),
    },
  ],
  exports: [PlatformDb],
})
export class SignupModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SignupActorContextMiddleware).forRoutes("*");
  }
}
