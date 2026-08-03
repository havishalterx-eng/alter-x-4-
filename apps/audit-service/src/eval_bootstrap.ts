import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";

import { PostgresAuditStoreProvider, startAuditGrpcTransport } from "@alterx/adapters";

import { AppModule } from "./app.module";
import { AUDIT_PROTO_PATH } from "./audit/grpc.constants";
import { AUDIT_MIGRATIONS_PATH } from "./database/migrations-path";

/**
 * Real, disclosed eval-only entrypoint -- NOT audit-service's production
 * main.ts. Production always requires real AWS Secrets Manager access
 * (for the database connection string AND the deletion secrets), with no
 * ALTER_CONFIG_SOURCE=mock escape hatch like model-gateway/tool-gateway
 * have. This script bypasses only that: a real PostgresAuditStoreProvider
 * built from a plain static connection string env var, and
 * AppModule.register(store) with no deletion wiring (deletion is
 * genuinely optional per app.module.ts's own real signature -- omitting
 * it only skips DeletionController, never touches RecordEvent/GetEvent's
 * real business logic). AuditService, AuditGrpcController,
 * PostgresAuditStoreProvider are all real and unmodified.
 */
async function bootstrap(): Promise<void> {
  const databaseUrl = process.env.EVAL_AUDIT_DB_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("eval_bootstrap requires EVAL_AUDIT_DB_URL");
  }
  const grpcBindAddress = process.env.GRPC_BIND_ADDRESS;
  if (grpcBindAddress === undefined || grpcBindAddress.length === 0) {
    throw new Error("eval_bootstrap requires GRPC_BIND_ADDRESS");
  }

  const store = new PostgresAuditStoreProvider({
    authentication: "static",
    connectionString: databaseUrl,
    migrationsFolder: AUDIT_MIGRATIONS_PATH,
  });
  await store.migrate();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(store),
    new FastifyAdapter(),
  );
  await startAuditGrpcTransport(app, {
    bindAddress: grpcBindAddress,
    protoPath: AUDIT_PROTO_PATH,
  });
  app.enableShutdownHooks();
}

void bootstrap();
