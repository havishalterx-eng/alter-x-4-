import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

import {
  SsrfGuardedFetcher,
  TavilySearchProvider,
  startToolgwGrpcTransport,
} from "@alterx/adapters";
import {
  createMockAuditEventHandler,
  createMockConfigProvider,
  createMockSecretsProvider,
} from "@alterx/shared-clients";

import { AppModule } from "../app.module";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function bootstrap(): Promise<void> {
  const credentialReference = requiredEnvironment(
    "TOOLGW_E2E_CREDENTIAL_REF",
  );
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(
      createMockConfigProvider({
        resolveToolPermission: async ({ toolName }) => ({
          allowed: toolName !== "search.denied",
          rateLimitPerMinute: 60,
          requiredScopes: [],
        }),
      }),
      createMockSecretsProvider({
        secrets: {
          [credentialReference]: requiredEnvironment(
            "TOOLGW_E2E_SECRET_VALUE",
          ),
        },
      }),
      new TavilySearchProvider({
        apiKey: requiredEnvironment("TOOLGW_E2E_TAVILY_API_KEY"),
        baseUrl: requiredEnvironment("TOOLGW_E2E_TAVILY_BASE_URL"),
      }),
      new SsrfGuardedFetcher(),
      createMockAuditEventHandler(),
    ),
    new FastifyAdapter(),
    { logger: false },
  );
  await startToolgwGrpcTransport(app, {
    bindAddress: requiredEnvironment("TOOLGW_E2E_GRPC_ADDRESS"),
    protoPath: requiredEnvironment("TOOLGW_E2E_PROTO_PATH"),
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  process.stdout.write("TOOLGW_E2E_READY\n");
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `tool-gateway e2e fixture failed: ${
      error instanceof Error ? error.message : "unknown error"
    }\n`,
  );
  process.exit(1);
});
