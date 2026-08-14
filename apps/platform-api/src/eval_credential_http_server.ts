import "reflect-metadata";

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Pool } from "pg";

import {
  ConcurrencyExceptionFilter,
  ETAG_RESOURCE_RESOLVER,
  EtagResponseInterceptor,
  IfMatchGuard,
} from "./concurrency";
import { IdempotencyModule } from "./idempotency";
import { CredentialController } from "./credentials/credential.controller";
import { CredentialEtagResolver } from "./credentials/credential-etag.resolver";
import { CredentialExceptionFilter } from "./credentials/credential-exception.filter";
import { CredentialRepository } from "./credentials/credential.repository";
import { CredentialService } from "./credentials/credential.service";
import { CREDENTIAL_AUDIT_CLIENT, CREDENTIAL_SECRETS_PROVIDER } from "./credentials/tokens";
import { createMockAuditEventHandler, createMockMutableSecretsProvider } from "@alterx/shared-clients";
import type { ActorContextType, RbacRequest } from "./rbac";

/**
 * Real, disclosed eval-only entrypoint for HARD-7g follow-up (tenant-
 * isolation's platform_credential_get/delete cases) -- NOT platform-api's
 * production main.ts, which boots the entire app.module.ts (every
 * feature module together). Reuses CredentialController,
 * CredentialService, CredentialRepository, CredentialEtagResolver,
 * IdempotencyModule unmodified -- a near-verbatim copy of
 * credentials/credential.module.ts's own real provider wiring, with two
 * swaps for dependencies unavailable here: AwsSecretsManagerProvider
 * (needs real AWS access) -> createMockMutableSecretsProvider(), and
 * AuditServiceClient (needs a live audit-service + real M2M creds) ->
 * createMockAuditEventHandler() (same in-memory fake
 * credential.controller.spec.ts already uses for CREDENTIAL_AUDIT_CLIENT).
 * CredentialService
 * requires the wider MutableSecretsProvider interface (put/deleteSecret,
 * not just getSecret) for its real update()/delete() paths -- the
 * read-only createMockSecretsProvider() used here originally satisfied
 * platform-api's own (loose, DI-token-based) typecheck but throws at
 * runtime the moment a real same-tenant update/delete actually reaches
 * the secrets provider (only cross-tenant not_found paths, which never
 * touch it, were exercised before the idempotency_replay follow-up).
 * get()/delete()'s real cross-tenant "not_found" behavior comes entirely
 * from CredentialRepository's own real, tenant-scoped SQL -- untouched.
 *
 * platform-api's real RbacGuard (like orchestration-service's
 * SessionGatewayGuard) needs a live JWT/JWKS not reachable here, so it
 * is not registered at all in this minimal module -- a synthetic
 * ActorContext is injected via a real Fastify onRequest hook instead,
 * same shape as eval_trigger_registry_http_server.ts (HARD-7j). Skipping
 * RbacGuard registration only skips the *role/permission* check; the
 * real tenant-isolation property under test lives entirely in
 * CredentialRepository's SQL, not in RbacGuard.
 */
function applyMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  const sql = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n--> statement-breakpoint\n");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean);
  return statements.reduce<Promise<void>>(
    (chain, statement) => chain.then(() => pool.query(statement).then(() => undefined)),
    Promise.resolve(),
  );
}

@Module({})
class EvalCredentialModule {
  static register(): DynamicModule {
    return {
      module: EvalCredentialModule,
      imports: [IdempotencyModule],
      controllers: [CredentialController],
      providers: [
        {
          provide: CredentialRepository,
          useFactory: () =>
            new CredentialRepository(
              new Pool({ connectionString: process.env.DATABASE_URL }),
              true,
            ),
        },
        {
          provide: CREDENTIAL_SECRETS_PROVIDER,
          useFactory: () => createMockMutableSecretsProvider(),
        },
        {
          provide: CREDENTIAL_AUDIT_CLIENT,
          useFactory: () => createMockAuditEventHandler(),
        },
        CredentialService,
        CredentialEtagResolver,
        { provide: ETAG_RESOURCE_RESOLVER, useExisting: CredentialEtagResolver },
        IfMatchGuard,
        EtagResponseInterceptor,
        ConcurrencyExceptionFilter,
        CredentialExceptionFilter,
      ],
    };
  }
}

function evalActorContext(tenantId: string): ActorContextType {
  return {
    user_id: "usr_eval-harness",
    tenant_id: tenantId,
    roles: ["admin"],
    permissions: ["*"],
    session_id: "eval-harness",
  };
}

async function bootstrap(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("eval_credential_http_server requires DATABASE_URL");
  }
  const tenantId = process.env.EVAL_TENANT_ID;
  if (tenantId === undefined || tenantId.length === 0) {
    throw new Error("eval_credential_http_server requires EVAL_TENANT_ID");
  }
  const httpPort = process.env.HTTP_PORT;
  if (httpPort === undefined || httpPort.length === 0) {
    throw new Error("eval_credential_http_server requires HTTP_PORT");
  }
  const migrationsDir = process.env.EVAL_MIGRATIONS_DIR;
  if (migrationsDir === undefined || migrationsDir.length === 0) {
    throw new Error("eval_credential_http_server requires EVAL_MIGRATIONS_DIR");
  }

  const migrationPool = new Pool({ connectionString: databaseUrl });
  await applyMigrations(migrationPool, migrationsDir);
  await migrationPool.end();

  const app = await NestFactory.create<NestFastifyApplication>(
    EvalCredentialModule.register(),
    new FastifyAdapter(),
  );
  const actorContext = evalActorContext(tenantId);
  app.getHttpAdapter().getInstance().addHook(
    "onRequest",
    (request: unknown, _reply: unknown, done: () => void) => {
      (request as RbacRequest).actorContext = actorContext;
      done();
    },
  );
  app.enableShutdownHooks();
  await app.listen(Number(httpPort), "127.0.0.1");
}

void bootstrap();
