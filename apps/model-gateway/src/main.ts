import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";

import {
  AnthropicModelProvider,
  AwsAppConfigConfigProvider,
  AwsBedrockModelProvider,
  AwsSecretsManagerProvider,
  FailoverModelProvider,
  OpenAiModelProvider,
  PresidioPIIRedactionProvider,
  startModelgwGrpcTransport,
} from "@alterx/adapters";
import {
  createMockConfigProvider,
  createMockModelProvider,
  createMockPIIRedactionProvider,
  type ConfigProvider,
  type ModelProvider,
  type PIIRedactionProvider,
} from "@alterx/shared-clients";

import { AppModule } from "./app.module";
import {
  loadModelGatewayEnvironment,
  type ModelGatewayAppConfigEnvironment,
} from "./config/environment";
import { MODELGW_PROTO_PATH } from "./gateway/grpc.constants";

function createConfigProvider(
  environment: ReturnType<typeof loadModelGatewayEnvironment>,
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

async function createModelProvider(
  environment: ReturnType<typeof loadModelGatewayEnvironment>,
): Promise<ModelProvider> {
  if (environment.configSource === "mock") {
    return createMockModelProvider();
  }

  const appConfigEnvironment: ModelGatewayAppConfigEnvironment = environment;
  const secretsProvider = new AwsSecretsManagerProvider({
    region: environment.region,
  });
  try {
    const [anthropicApiKey, openaiApiKey] = await Promise.all([
      secretsProvider.getSecret(
        appConfigEnvironment.anthropicApiKeySecretReference,
      ),
      secretsProvider.getSecret(
        appConfigEnvironment.openaiApiKeySecretReference,
      ),
    ]);

    const primary = new AwsBedrockModelProvider({ region: environment.region });
    const anthropic = new AnthropicModelProvider({ apiKey: anthropicApiKey });
    const openai = new OpenAiModelProvider({ apiKey: openaiApiKey });

    return new FailoverModelProvider(primary, { anthropic, openai });
  } finally {
    secretsProvider.close();
  }
}

function createPIIRedactionProvider(
  environment: ReturnType<typeof loadModelGatewayEnvironment>,
): PIIRedactionProvider {
  if (environment.configSource === "mock") {
    return createMockPIIRedactionProvider();
  }
  return new PresidioPIIRedactionProvider({
    analyzerBaseUrl: environment.presidioAnalyzerUrl,
    anonymizerBaseUrl: environment.presidioAnonymizerUrl,
  });
}

async function bootstrap(): Promise<void> {
  const environment = loadModelGatewayEnvironment(process.env);
  const configProvider = createConfigProvider(environment);
  const modelProvider = await createModelProvider(environment);
  const piiRedactionProvider = createPIIRedactionProvider(environment);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(configProvider, modelProvider, piiRedactionProvider),
    new FastifyAdapter(),
  );
  await startModelgwGrpcTransport(app, {
    bindAddress: environment.grpcBindAddress,
    protoPath: MODELGW_PROTO_PATH,
  });
  app.enableShutdownHooks();
  await app.listen(environment.httpPort, "0.0.0.0");
}

void bootstrap();
