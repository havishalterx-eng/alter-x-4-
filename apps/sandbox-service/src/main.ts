import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

import {
  AgentCoreSandboxProvider,
  AwsAppConfigConfigProvider,
  ArtifactContentClient,
  AwsSecretsManagerProvider,
  BrowserbasePlaywrightProvider,
  E2bSandboxProvider,
  MockBrowserAutomationProvider,
  PostgresToolDatabaseProvider,
  SqsQueueProvider,
  SsrfGuardedFetcher,
  startSandboxGrpcTransport,
  type BrowserAutomationProvider,
} from "@alterx/adapters";
import {
  createMockConfigProvider,
  createMockQueueProvider,
  createMockSandboxProvider,
  createMockSecretsProvider,
  type ConfigProvider,
  type QueueProvider,
  type SandboxProvider,
  type SecretsProvider,
} from "@alterx/shared-clients";

import { AppModule } from "./app.module";
import {
  loadSandboxEnvironment,
  type SandboxEnvironment,
} from "./config/environment";

function createSecretsProvider(
  environment: SandboxEnvironment,
): SecretsProvider {
  return environment.localMock
    ? createMockSecretsProvider()
    : new AwsSecretsManagerProvider({ region: environment.region });
}

async function createSandboxProvider(
  environment: SandboxEnvironment,
  secrets: SecretsProvider,
): Promise<SandboxProvider> {
  if (environment.localMock) return createMockSandboxProvider();
  if (environment.sandboxProvider === "agentcore") {
    return new AgentCoreSandboxProvider({ region: environment.region });
  }
  return new E2bSandboxProvider({
    apiKey: await secrets.getSecret(environment.e2bApiKeyReference),
  });
}

function createConfigProvider(
  environment: SandboxEnvironment,
): ConfigProvider {
  if (environment.localMock) {
    return createMockConfigProvider({
      toolPermission: {
        allowed: true,
        rateLimitPerMinute: 60,
        requiredScopes: ["database:*"],
      },
    });
  }
  return new AwsAppConfigConfigProvider({
    region: environment.region,
    applicationIdentifier: environment.appConfigApplicationId,
    environmentIdentifier: environment.appConfigEnvironmentId,
    configurationProfileIdentifier:
      environment.appConfigConfigurationProfileId,
  });
}

async function createBrowserProvider(
  environment: SandboxEnvironment,
  secrets: SecretsProvider,
  urlFetcher: SsrfGuardedFetcher,
): Promise<BrowserAutomationProvider> {
  if (environment.localMock) {
    return new MockBrowserAutomationProvider(urlFetcher);
  }
  return new BrowserbasePlaywrightProvider(
    {
      apiKey: await secrets.getSecret(environment.browserbaseApiKeyReference),
      projectId: environment.browserbaseProjectId,
    },
    urlFetcher,
  );
}

function createQueueProvider(environment: SandboxEnvironment): QueueProvider {
  return environment.localMock
    ? createMockQueueProvider()
    : new SqsQueueProvider({
        region: environment.region,
        ...(process.env.AWS_ENDPOINT_URL ? { endpoint: process.env.AWS_ENDPOINT_URL, useQueueUrlAsEndpoint: false } : {}),
      });
}
import { SANDBOX_PROTO_PATH } from "./sandbox/grpc.constants";
import { ARTIFACT_CONTENT_PROTO_PATH } from "./artifacts/grpc.constants";

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}

async function bootstrap(): Promise<void> {
  const environment = loadSandboxEnvironment(process.env);
  const secrets = createSecretsProvider(environment);
  const urlFetcher = new SsrfGuardedFetcher({
    maxResponseBytes: 1_048_576,
  });
  const sandbox = await createSandboxProvider(environment, secrets);
  const browser = await createBrowserProvider(
    environment,
    secrets,
    urlFetcher,
  );
  const config = createConfigProvider(environment);
  const costQueue = createQueueProvider(environment);
  const database = new PostgresToolDatabaseProvider(secrets);
  const artifacts = new ArtifactContentClient({
    address: environment.artifactContentServiceAddress,
    protoPath: ARTIFACT_CONTENT_PROTO_PATH,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(sandbox, artifacts, {
      browser,
      config,
      database,
      urlFetcher,
      costQueue,
      costEventsQueueName: `alter-${environment.alterEnvironment}-cost-events`,
    }),
    new FastifyAdapter(),
  );
  app.enableShutdownHooks();
  await startSandboxGrpcTransport(app, {
    bindAddress: environment.grpcBindAddress,
    protoPath: SANDBOX_PROTO_PATH,
  });
  await app.listen(parsePort(process.env.PORT), "0.0.0.0");
}

void bootstrap();
