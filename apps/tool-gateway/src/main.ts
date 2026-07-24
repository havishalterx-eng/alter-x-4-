import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";

import {
  AwsAppConfigConfigProvider,
  AwsSecretsManagerProvider,
  startToolgwGrpcTransport,
} from "@alterx/adapters";
import {
  createMockConfigProvider,
  createMockSecretsProvider,
  type ConfigProvider,
  type SecretsProvider,
} from "@alterx/shared-clients";

import { AppModule } from "./app.module";
import { loadToolGatewayEnvironment } from "./config/environment";
import { TOOLGW_PROTO_PATH } from "./gateway/grpc.constants";

function createConfigProvider(
  environment: ReturnType<typeof loadToolGatewayEnvironment>,
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
  environment: ReturnType<typeof loadToolGatewayEnvironment>,
): SecretsProvider {
  if (environment.configSource === "mock") {
    return createMockSecretsProvider();
  }
  return new AwsSecretsManagerProvider({ region: environment.region });
}

async function bootstrap(): Promise<void> {
  const environment = loadToolGatewayEnvironment(process.env);
  const configProvider = createConfigProvider(environment);
  const secretsProvider = createSecretsProvider(environment);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(configProvider, secretsProvider),
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
