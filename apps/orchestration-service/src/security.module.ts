import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import {
  ActorTokenValidator,
  M2mValidator,
  RedisReplayStore,
  RedisRespSetClient,
  SessionGatewayGuard,
  SessionGatewayRateLimitGuard,
  SessionGatewayUploadAllowlistGuard,
} from "@alterx/auth";

import {
  OrchestrationInfrastructureModule,
  orchestrationStore,
  sessionGatewayEnvironment,
} from "./orchestration-infrastructure.module";

/**
 * Owns the three global APP_GUARD registrations in their exact order --
 * order is material (SessionGatewayGuard authenticates before the rate
 * limiter and upload allowlist run). Does not register
 * SessionGatewayPromptInjectionGuard (present and tested in
 * packages/auth/session-gateway but never wired into this composition
 * root's guard chain) -- that's a separate, pre-existing security-product
 * gap this refactor deliberately does not fold in, per the design doc's
 * own note under "Evidence and non-goals."
 */
@Module({
  imports: [OrchestrationInfrastructureModule],
  providers: [
    {
      provide: APP_GUARD,
      useFactory: () => {
        const config = sessionGatewayEnvironment(process.env);
        const replayStore = new RedisReplayStore(
          new RedisRespSetClient(config.redisUrl),
        );
        return new SessionGatewayGuard(
          new M2mValidator({
            auth0Domain: config.auth0Domain,
            apiAudience: config.apiAudience,
            ...(config.auth0JwksUrl ? { jwksUrl: config.auth0JwksUrl } : {})
          }),
          new ActorTokenValidator(
            {
              issuer: config.actorTokenIssuer,
              audience: config.actorTokenAudience,
              jwksUrl: config.actorTokenJwksUrl,
            },
            replayStore,
          ),
          orchestrationStore(config),
        );
      },
    },
    {
      provide: APP_GUARD,
      useFactory: () => new SessionGatewayRateLimitGuard(),
    },
    {
      provide: APP_GUARD,
      useFactory: () => new SessionGatewayUploadAllowlistGuard(),
    },
  ],
})
export class SecurityModule {}
