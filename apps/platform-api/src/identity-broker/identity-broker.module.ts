import { Module } from "@nestjs/common";
import { IdentityBrokerService } from "./identity-broker.service";
import { GeneratedSigningKeyResolver } from "./signing-key-resolver";

@Module({
  providers: [
    {
      provide: IdentityBrokerService,
      useFactory: () =>
        new IdentityBrokerService(
          process.env.ACTOR_TOKEN_SIGNING_KEY_REF ?? "local/actor-token-signing-key",
          new GeneratedSigningKeyResolver(),
        ),
    },
  ],
  exports: [IdentityBrokerService],
})
export class IdentityBrokerModule {}
