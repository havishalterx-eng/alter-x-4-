import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";

import { AwsAppConfigConfigProvider, startModelgwGrpcTransport } from "@alterx/adapters";
import {
  createMockConfigProvider,
  createMockModelProvider,
  type ConfigProvider,
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

async function bootstrap(): Promise<void> {
  const environment = loadModelGatewayEnvironment(process.env);
  const configProvider = createConfigProvider(environment);
  // Real Bedrock invocation is GATE-2; GATE-1 wires the skeleton and alias
  // resolution against a mock ModelProvider so the service is swap-ready.
  const modelProvider = createMockModelProvider();

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
