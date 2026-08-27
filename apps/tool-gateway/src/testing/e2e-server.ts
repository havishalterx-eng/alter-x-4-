import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

import {
  MockBrowserAutomationProvider,
  MockEmailProvider,
  SsrfGuardedFetcher,
  TavilySearchProvider,
  startToolgwGrpcTransport,
  type DatabaseOperationProvider,
} from "@alterx/adapters";
import {
  createMockAuditEventHandler,
  createMockCacheProvider,
  createMockConfigProvider,
  createMockQueueProvider,
  createMockSecretsProvider,
} from "@alterx/shared-clients";

import { AppModule } from "../app.module";

// This e2e fixture exercises search.web only -- a fake database provider
// that fails loudly if ever invoked is more honest than a working mock
// nobody's e2e coverage exercises.
const unexercisedDatabaseProvider: DatabaseOperationProvider = {
  providerId: "e2e-fixture-unexercised",
  execute: () => {
    throw new Error("e2e-server fixture does not exercise database.* tool dispatch");
  },
};

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
      unexercisedDatabaseProvider,
      createMockQueueProvider(),
      "toolgw-e2e-cost-events",
      createMockCacheProvider(),
      // e2e fixture exercises search.web only; disclosed mock browser/
      // email providers, same reasoning as unexercisedDatabaseProvider.
      new MockBrowserAutomationProvider(new SsrfGuardedFetcher()),
      new MockEmailProvider(),
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
