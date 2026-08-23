import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";

import {
  AuditServiceClient,
  AwsAppConfigConfigProvider,
  AwsSecretsManagerProvider,
  PostgresToolDatabaseProvider,
  SqsQueueProvider,
  SsrfGuardedFetcher,
  TavilySearchProvider,
  startToolgwGrpcTransport,
} from "@alterx/adapters";
import {
  createMockAuditEventHandler,
  createMockConfigProvider,
  createMockQueueProvider,
  createMockSearchProvider,
  createMockSecretsProvider,
  type AuditEventHandler,
  type ConfigProvider,
  type QueueProvider,
  type SearchProvider,
  type SecretsProvider,
} from "@alterx/shared-clients";
import { lazyAuth0M2mTokenProviderFromEnvironment } from "@alterx/auth";

import { AppModule } from "./app.module";
import { loadToolGatewayEnvironment } from "./config/environment";
import {
  AUDIT_CLIENT_PROTO_PATH,
  TOOLGW_PROTO_PATH,
} from "./gateway/grpc.constants";

type ToolGatewayEnvironment = ReturnType<typeof loadToolGatewayEnvironment>;

function createConfigProvider(
  environment: ToolGatewayEnvironment,
): ConfigProvider {
  if (environment.configSource === "mock") {
    return createMockConfigProvider();
  }
  return new AwsAppConfigConfigProvider({
    region: environment.region,
    applicationIdentifier: environment.appConfigApplicationId,
    environmentIdentifier: environment.appConfigEnvironmentId,
    configurationProfileIdentifier: environment.appConfigConfigurationProfileId,
  });
}

function createSecretsProvider(
  environment: ToolGatewayEnvironment,
): SecretsProvider {
  if (environment.configSource === "mock") {
    return createMockSecretsProvider();
  }
  return new AwsSecretsManagerProvider({ region: environment.region });
}

async function createSearchProvider(
  environment: ToolGatewayEnvironment,
  secretsProvider: SecretsProvider,
): Promise<SearchProvider> {
  if (environment.configSource === "mock") {
    return createMockSearchProvider();
  }
  const apiKey = await secretsProvider.getSecret(
    environment.tavilyApiKeySecretRef,
  );
  return new TavilySearchProvider({ apiKey });
}

function createAuditClient(
  environment: ToolGatewayEnvironment,
): AuditEventHandler {
  if (environment.configSource === "mock") {
    return createMockAuditEventHandler();
  }
  return new AuditServiceClient({
    address: environment.auditServiceGrpcAddress,
    protoPath: AUDIT_CLIENT_PROTO_PATH,
    accessTokenProvider: lazyAuth0M2mTokenProviderFromEnvironment(process.env),
  });
}

function createQueueProvider(environment: ToolGatewayEnvironment): QueueProvider {
  return environment.configSource === "mock"
    ? createMockQueueProvider()
    : new SqsQueueProvider({
        region: environment.region,
        ...(process.env.AWS_ENDPOINT_URL
          ? { endpoint: process.env.AWS_ENDPOINT_URL, useQueueUrlAsEndpoint: false }
          : {}),
      });
}

async function bootstrap(): Promise<void> {
  const environment = loadToolGatewayEnvironment(process.env);
  const configProvider = createConfigProvider(environment);
  const secretsProvider = createSecretsProvider(environment);
  const searchProvider = await createSearchProvider(environment, secretsProvider);
  const urlFetcher = new SsrfGuardedFetcher();
  const auditClient = createAuditClient(environment);
  const databaseProvider = new PostgresToolDatabaseProvider(secretsProvider);
  const costQueue = createQueueProvider(environment);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(
      configProvider,
      secretsProvider,
      searchProvider,
      urlFetcher,
      auditClient,
      databaseProvider,
      costQueue,
      `alter-${environment.alterEnvironment}-cost-events`,
    ),
    new FastifyAdapter(),
  );
  await startToolgwGrpcTransport(app, {
    bindAddress: environment.grpcBindAddress,
    protoPath: TOOLGW_PROTO_PATH,
  });
  app.enableShutdownHooks();
  await app.listen(environment.httpPort, "0.0.0.0");
}

void bootstrap();
