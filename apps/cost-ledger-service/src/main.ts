import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";

import { AwsSecretsManagerProvider, PostgresCostStoreProvider } from "@alterx/adapters";

import { AppModule } from "./app.module";
import { loadCostLedgerEnvironment } from "./config/environment";
import { COST_MIGRATIONS_PATH } from "./database/migrations-path";
import { resolveDatabaseConnectionString } from "./database/resolve-database-secret";

async function bootstrap(): Promise<void> {
  const environment = loadCostLedgerEnvironment(process.env);
  let secretsProvider: AwsSecretsManagerProvider | undefined;
  let store: PostgresCostStoreProvider | undefined;

  try {
    if (environment.databaseAuthentication === "iam") {
      store = new PostgresCostStoreProvider({
        authentication: "iam",
        host: environment.databaseHost,
        port: environment.databasePort,
        database: environment.databaseName,
        user: environment.databaseUser,
        region: environment.region,
        migrationsFolder: COST_MIGRATIONS_PATH,
      });
    } else {
      secretsProvider = new AwsSecretsManagerProvider({ region: "ap-south-1" });
      const connectionString = await resolveDatabaseConnectionString(
        secretsProvider,
        environment.databaseSecretReference,
      );
      store = new PostgresCostStoreProvider({
        authentication: "static",
        connectionString,
        migrationsFolder: COST_MIGRATIONS_PATH,
      });
    }
    await store.migrate();

    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register(store),
      new FastifyAdapter(),
    );
    app.enableShutdownHooks();
    await app.listen(environment.httpPort, "0.0.0.0");
  } catch (error: unknown) {
    await store?.close();
    throw error;
  } finally {
    secretsProvider?.close();
  }
}

void bootstrap();
