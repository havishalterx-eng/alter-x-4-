import { Module } from "@nestjs/common";
import type { SecretsProvider } from "@alterx/shared-clients";
import { validatePlatformApiEnv } from "../config/env.schema";
import { IdentityBrokerService } from "./identity-broker.service";
import { EnvironmentSecretsProvider } from "./secrets-provider";
import {
  GeneratedSigningKeyResolver,
  SecretsProviderSigningKeyResolver,
} from "./signing-key-resolver";

export const secretsProviderToken = Symbol("SecretsProvider");

@Module({
  providers: [
    {
      provide: secretsProviderToken,
      useClass: EnvironmentSecretsProvider,
    },
    {
      provide: IdentityBrokerService,
      inject: [secretsProviderToken],
      useFactory: async (secretsProvider: SecretsProvider) => {
        const environment = validatePlatformApiEnv(process.env);
        if (environment.SIGNING_KEY_PROVIDER === "mock") {
          if (process.env.NODE_ENV !== "test") {
            throw new Error("Mock signing keys are restricted to NODE_ENV=test");
          }
          return new IdentityBrokerService("test/mock-signing-key", new GeneratedSigningKeyResolver());
        }

        const keyRef = environment.ACTOR_TOKEN_SIGNING_KEY_REF!;
        const resolver = new SecretsProviderSigningKeyResolver(secretsProvider);
        await resolver.resolvePublicKey(keyRef);
        return new IdentityBrokerService(keyRef, resolver);
      },
    },
  ],
  exports: [IdentityBrokerService],
})
export class IdentityBrokerModule {}
