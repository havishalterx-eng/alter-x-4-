import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";

import {
  AwsAppConfigConfigProvider,
  AwsBedrockModelProvider,
  startModelgwGrpcTransport,
} from "@alterx/adapters";
import {
  createMockConfigProvider,
  createMockModelProvider,
  type ConfigProvider,
  type ModelProvider,
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

async function bootstrap(): Promise<void> {
  const environment = loadModelGatewayEnvironment(process.env);
  const configProvider = createConfigProvider(environment);
  const modelProvider = createModelProvider(environment);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(configProvider, modelProvider),
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
