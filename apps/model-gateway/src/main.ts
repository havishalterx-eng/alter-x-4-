import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";

import {
  AwsAppConfigConfigProvider,
  AwsBedrockModelProvider,
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
import { loadModelGatewayEnvironment } from "./config/environment";
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

function createModelProvider(
  environment: ReturnType<typeof loadModelGatewayEnvironment>,
): ModelProvider {
  if (environment.configSource === "mock") {
    return createMockModelProvider();
  }
  return new AwsBedrockModelProvider({ region: environment.region });
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
  const modelProvider = createModelProvider(environment);
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
