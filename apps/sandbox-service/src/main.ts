import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { AwsSecretsManagerProvider, E2bSandboxProvider } from "@alterx/adapters";
import { createMockSandboxProvider, createMockSecretsProvider } from "@alterx/shared-clients";
import { AppModule } from "./app.module";
import { loadSandboxEnvironment } from "./config/environment";

async function bootstrap(): Promise<void> {
  const environment = loadSandboxEnvironment(process.env);
  const secrets = environment.localMock ? createMockSecretsProvider() : new AwsSecretsManagerProvider({ region: environment.region });
  const sandbox = environment.localMock ? createMockSandboxProvider() : new E2bSandboxProvider({ apiKey: await secrets.getSecret(environment.e2bApiKeyReference!) });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(sandbox),
    new FastifyAdapter(),
  );
  await app.listen(3000, "0.0.0.0");
}

void bootstrap();
