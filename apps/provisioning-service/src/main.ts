import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  AwsSecretsManagerProvider,
  E2bSandboxProvider,
  startProvisioningGrpcTransport,
} from "@alterx/adapters";
import { createMockSandboxProvider, createMockSecretsProvider } from "@alterx/shared-clients";
import { AppModule } from "./app.module";
import { loadProvisioningEnvironment } from "./config/environment";
import { PROVISIONING_PROTO_PATH } from "./provisioning/grpc.constants";

async function bootstrap(): Promise<void> {
  const environment = loadProvisioningEnvironment(process.env);
  const secrets = environment.localMock
    ? createMockSecretsProvider()
    : new AwsSecretsManagerProvider({ region: environment.region });
  const sandbox = environment.localMock
    ? createMockSandboxProvider()
    : new E2bSandboxProvider({
        apiKey: await secrets.getSecret(environment.e2bApiKeyReference!),
      });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(sandbox, secrets),
    new FastifyAdapter(),
  );
  await startProvisioningGrpcTransport(app, {
    bindAddress: environment.grpcBindAddress,
    protoPath: PROVISIONING_PROTO_PATH,
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
}
void bootstrap();
