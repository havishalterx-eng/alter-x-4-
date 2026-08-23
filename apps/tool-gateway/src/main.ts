import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";

import {
  AuditServiceClient,
  AwsAppConfigConfigProvider,
  AwsSecretsManagerProvider,
  BrowserbasePlaywrightProvider,
  MockBrowserAutomationProvider,
  PostgresToolDatabaseProvider,
  RedisCacheProvider,
  SqsQueueProvider,
  SsrfGuardedFetcher,
  TavilySearchProvider,
  startToolgwGrpcTransport,
  type BrowserAutomationProvider,
} from "@alterx/adapters";
import {
  createMockAuditEventHandler,
  createMockCacheProvider,
  createMockConfigProvider,
  createMockQueueProvider,
  createMockSearchProvider,
  createMockSecretsProvider,
  type AuditEventHandler,
  type CacheProvider,
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

function createCacheProvider(environment: ToolGatewayEnvironment): CacheProvider {
  if (environment.configSource === "mock") {
    return createMockCacheProvider();
  }
  return new RedisCacheProvider({
    host: environment.cacheRedisHost,
    port: environment.cacheRedisPort,
  });
}

// ENGINE-RESTRUCTURE-P4-1b: browser automation moved here from sandbox-
// service (createBrowserProvider, mirrored field-for-field -- same env
// var names BROWSERBASE_API_KEY_REF / BROWSERBASE_PROJECT_ID). The real
// Browserbase API key is one platform-wide secret resolved once at
// startup; per-call credential_refs for browser.* use the reserved
// browser-automation template and resolve no secret (see
// tool-gateway.service.ts).
async function createBrowserProvider(
  environment: ToolGatewayEnvironment,
  secretsProvider: SecretsProvider,
  urlFetcher: SsrfGuardedFetcher,
): Promise<BrowserAutomationProvider> {
  if (environment.configSource === "mock") {
    return new MockBrowserAutomationProvider(urlFetcher);
  }
  return new BrowserbasePlaywrightProvider(
    {
      apiKey: await secretsProvider.getSecret(
        environment.browserbaseApiKeyReference,
      ),
      projectId: environment.browserbaseProjectId,
    },
    urlFetcher,
  );
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
  const cacheProvider = createCacheProvider(environment);
  const browserProvider = await createBrowserProvider(
    environment,
    secretsProvider,
    urlFetcher,
  );

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
      cacheProvider,
      browserProvider,
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
