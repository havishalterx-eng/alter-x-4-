import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { resolveRuntimeSecret } from "../identity/identity.module";
import { IdentityBrokerModule } from "../identity-broker/identity-broker.module";
import { IdentityBrokerService } from "../identity-broker/identity-broker.service";
import {
  Auth0EngineM2mTokenProvider,
  ENGINE_AUTH_PROVIDER,
  ENGINE_M2M_TOKEN_PROVIDER,
  IdentityBrokerEngineAuthProvider,
  type EngineM2mTokenProvider,
} from "./auth";
import { engineConfigFromEnvironment, type EngineConfig } from "./config";
import { ENGINE_CONFIG, EngineClient } from "./engine-client";
import { CostLedgerClient } from "./cost-ledger-client";
import { EngineExceptionFilter } from "./engine-exception.filter";

@Module({
  imports: [IdentityBrokerModule],
  providers: [
    {
      provide: ENGINE_CONFIG,
      useFactory: () => engineConfigFromEnvironment(process.env),
    },
    {
      provide: ENGINE_M2M_TOKEN_PROVIDER,
      inject: [ENGINE_CONFIG],
      useFactory: (config: EngineConfig): EngineM2mTokenProvider =>
        new Auth0EngineM2mTokenProvider({
          tokenUrl: config.m2mTokenUrl,
          audience: config.m2mAudience,
          clientId: config.m2mClientId,
          clientSecretRef: config.m2mClientSecretRef,
          resolveSecret: resolveRuntimeSecret,
        }),
    },
    {
      provide: ENGINE_AUTH_PROVIDER,
      inject: [IdentityBrokerService, ENGINE_M2M_TOKEN_PROVIDER],
      useFactory: (
        identityBroker: IdentityBrokerService,
        tokenProvider: EngineM2mTokenProvider,
      ) => new IdentityBrokerEngineAuthProvider(identityBroker, tokenProvider),
    },
    {
      provide: EngineClient,
      inject: [ENGINE_CONFIG, ENGINE_AUTH_PROVIDER],
      useFactory: (
        config: EngineConfig,
        authProvider: IdentityBrokerEngineAuthProvider,
      ) => new EngineClient(config, authProvider),
    },
    {
      provide: CostLedgerClient,
      inject: [ENGINE_CONFIG, ENGINE_AUTH_PROVIDER],
      useFactory: (
        config: EngineConfig,
        authProvider: IdentityBrokerEngineAuthProvider,
      ) => new CostLedgerClient(config, authProvider),
    },
    {
      provide: APP_FILTER,
      useClass: EngineExceptionFilter,
    },
  ],
  exports: [EngineClient, CostLedgerClient],
})
export class EngineModule {}
