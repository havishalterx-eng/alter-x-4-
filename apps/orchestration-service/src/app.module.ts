import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PostgresOrchestrationStoreProvider } from "@alterx/adapters";
import {
  ActorTokenValidator,
  M2mValidator,
  RedisReplayStore,
  RedisRespSetClient,
  SessionGatewayGuard,
} from "@alterx/auth";
import { ORCHESTRATION_MIGRATIONS_PATH } from "./database/migrations-path";
import { HealthController } from "./health/health.controller";

@Module({
  controllers: [HealthController],
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
          }),
          new ActorTokenValidator(
            {
              issuer: config.actorTokenIssuer,
              audience: config.actorTokenAudience,
              jwksUrl: config.actorTokenJwksUrl,
            },
            replayStore,
          ),
          new PostgresOrchestrationStoreProvider({
            authentication: "iam",
            host: config.databaseHost,
            port: config.databasePort,
            database: config.databaseName,
            user: config.databaseUser,
            region: config.awsRegion,
            migrationsFolder: ORCHESTRATION_MIGRATIONS_PATH,
          }),
        );
      },
    },
  ],
})
export class AppModule {}

interface SessionGatewayEnvironment {
  readonly auth0Domain: string;
  readonly apiAudience: string;
  readonly actorTokenIssuer: string;
  readonly actorTokenAudience: string;
  readonly actorTokenJwksUrl: string;
  readonly redisUrl: string;
  readonly databaseHost: string;
  readonly databasePort: number;
  readonly databaseName: string;
  readonly databaseUser: string;
  readonly awsRegion: string;
}

function sessionGatewayEnvironment(
  env: NodeJS.ProcessEnv,
): SessionGatewayEnvironment {
  assertProductionSessionGatewayConfiguration(env);

  return {
    auth0Domain: requiredEnvironment(env, "AUTH0_DOMAIN"),
    apiAudience: requiredEnvironment(env, "AUTH0_API_AUDIENCE"),
    actorTokenIssuer: requiredEnvironment(env, "ACTOR_TOKEN_ISSUER"),
    actorTokenAudience: requiredEnvironment(env, "ACTOR_TOKEN_AUDIENCE"),
    actorTokenJwksUrl: requiredEnvironment(env, "ACTOR_TOKEN_JWKS_URL"),
    redisUrl: requiredEnvironment(env, "REDIS_ENDPOINT"),
    databaseHost: requiredEnvironment(env, "ORCHESTRATION_DATABASE_HOST"),
    databasePort: requiredPort(env, "ORCHESTRATION_DATABASE_PORT"),
    databaseName: requiredEnvironment(env, "ORCHESTRATION_DATABASE_NAME"),
    databaseUser: requiredEnvironment(env, "ORCHESTRATION_DATABASE_USER"),
    awsRegion: requiredEnvironment(env, "AWS_REGION"),
  };
}

function assertProductionSessionGatewayConfiguration(
  env: NodeJS.ProcessEnv,
): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  if (env.INGRESS_SESSION_GATEWAY_CORE_ENABLED !== "true") {
    throw new Error(
      "Production Session Gateway requires feature flag ingress.sessionGatewayCore",
    );
  }
  if (env.ACTOR_TOKEN_TEST_SIGNER_ENABLED === "true") {
    throw new Error("Actor-token test signer cannot be enabled in production");
  }
}

function requiredEnvironment(
  env: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required Session Gateway configuration: ${name}`);
  }
  return value;
}

function requiredPort(env: NodeJS.ProcessEnv, name: string): number {
  const value = Number(requiredEnvironment(env, name));
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(
      `Invalid Session Gateway configuration: ${name} must be a port`,
    );
  }
  return value;
}
