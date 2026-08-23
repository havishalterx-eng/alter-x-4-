import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";

import {
  SsrfGuardedFetcher,
  startToolgwGrpcTransport,
  type DatabaseOperationProvider,
} from "@alterx/adapters";
import {
  createMockAuditEventHandler,
  createMockConfigProvider,
  createMockQueueProvider,
  createMockSearchProvider,
  createMockSecretsProvider,
} from "@alterx/shared-clients";

// Eval-only entrypoint never dispatches database.* tool calls -- a fake
// that fails loudly if it's ever somehow invoked is more honest here than
// a working mock nobody exercises.
const unexercisedDatabaseProvider: DatabaseOperationProvider = {
  providerId: "eval-credential-server-unexercised",
  execute: () => {
    throw new Error(
      "eval_credential_grpc_server does not exercise database.* tool dispatch",
    );
  },
};

import { AppModule } from "./app.module";
import { TOOLGW_PROTO_PATH } from "./gateway/grpc.constants";

/**
 * Real, disclosed eval-only entrypoint for tenant-isolation's
 * tool_consume_credential case (HARD-7g follow-up #2) -- NOT tool-gateway's
 * production main.ts. AppModule.register() and ToolGatewayService are real
 * and unmodified: the same real ResolveCredential/InvokeTool code paths,
 * same real in-memory #credentialTokens map, same real
 * assertCredentialReferenceOwnedBy ownership check run under production
 * main.ts with ALTER_CONFIG_SOURCE=mock.
 *
 * The ONE difference from running the real main.js directly: production's
 * createMockSecretsProvider() call takes no options, so it only ever seeds
 * one fixed key ("contract/secret") that can never satisfy
 * parseTenantIntegrationSecretReference's real ownership-check shape
 * (`/alter/<env>/tenant/<id>/integration/<id>/...`) -- a real, unmodified
 * secret reference that also passes ownership can therefore never resolve
 * under the plain defaults. This entrypoint seeds the same mock secrets
 * provider with one additional key equal to EVAL_CREDENTIAL_REF, so the
 * real #resolveRawSecretReference -> secretsProvider.getSecret() call
 * (verbatim, unmodified) succeeds for a real, ownership-valid reference,
 * letting ResolveCredential mint a real opaque token for real InvokeTool
 * cross-tenant testing.
 */
async function bootstrap(): Promise<void> {
  const grpcBindAddress = process.env.GRPC_BIND_ADDRESS;
  if (grpcBindAddress === undefined || grpcBindAddress.length === 0) {
    throw new Error("eval_credential_grpc_server requires GRPC_BIND_ADDRESS");
  }
  const httpPort = process.env.HTTP_PORT;
  if (httpPort === undefined || httpPort.length === 0) {
    throw new Error("eval_credential_grpc_server requires HTTP_PORT");
  }
  const credentialRef = process.env.EVAL_CREDENTIAL_REF;
  if (credentialRef === undefined || credentialRef.length === 0) {
    throw new Error("eval_credential_grpc_server requires EVAL_CREDENTIAL_REF");
  }
  const secretValue = process.env.EVAL_SECRET_VALUE;
  if (secretValue === undefined || secretValue.length === 0) {
    throw new Error("eval_credential_grpc_server requires EVAL_SECRET_VALUE");
  }

  const configProvider = createMockConfigProvider();
  const secretsProvider = createMockSecretsProvider({
    secrets: {
      "contract/secret": "contract-secret-value",
      [credentialRef]: secretValue,
    },
  });
  const searchProvider = createMockSearchProvider();
  const urlFetcher = new SsrfGuardedFetcher();
  const auditClient = createMockAuditEventHandler();
  const costQueue = createMockQueueProvider();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(
      configProvider,
      secretsProvider,
      searchProvider,
      urlFetcher,
      auditClient,
      unexercisedDatabaseProvider,
      costQueue,
      "eval-credential-server-cost-events",
    ),
    new FastifyAdapter(),
  );
  await startToolgwGrpcTransport(app, {
    bindAddress: grpcBindAddress,
    protoPath: TOOLGW_PROTO_PATH,
  });
  app.enableShutdownHooks();
  await app.listen(Number(httpPort), "127.0.0.1");
}

void bootstrap();
