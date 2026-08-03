import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { Module, type DynamicModule } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { PostgresOrchestrationStoreProvider } from "@alterx/adapters";
import type { ActorContext, SessionGatewayRequest } from "@alterx/auth";

import { ProjectReadController } from "./project-read/project-read.controller";
import { ProjectReadService } from "./project-read/project-read.service";

/**
 * Real, disclosed eval-only entrypoint for tenant-isolation's
 * project_get and project_deploy cases -- NOT orchestration-service's
 * production main.ts. ProjectReadController is real and unmodified;
 * ProjectReadService is real, constructed directly with a real Postgres
 * store, same "one real service" pattern as
 * eval_workflow_read_http_server.ts.
 *
 * The real cross-tenant check comes entirely from the `projects`/
 * `deployments` tables' own RLS policies (0019_create_projects.sql)
 * combined with ProjectReadService's own explicit
 * `WHERE tenant_id = $1 AND id = $2` -- a cross-tenant read/deploy is a
 * real 404 PROJECT_NOT_FOUND, matching the golden set's "not_found"
 * outcome for both cases.
 *
 * Production main.ts applies SessionGatewayGuard globally (APP_GUARD),
 * which populates `request.actorContext` from a real, signed JWT -- that
 * guard is not wired here (no real signing keys/JWKS reachable in this
 * environment). Instead, a real Fastify onRequest hook sets a synthetic,
 * disclosed ActorContext directly, same shape as every other eval-only
 * entrypoint in this campaign.
 */
function evalAuthActorContext(tenantId: string): ActorContext {
  return {
    actor_type: "service",
    user_id: null,
    tenant_id: tenantId,
    workspace_id: null,
    roles: ["eval-harness"],
    permissions: ["*"],
    session_id: null,
    jti: null,
  };
}

@Module({})
class EvalProjectReadModule {
  static register(store: PostgresOrchestrationStoreProvider): DynamicModule {
    return {
      module: EvalProjectReadModule,
      controllers: [ProjectReadController],
      providers: [{ provide: ProjectReadService, useValue: new ProjectReadService(store) }],
    };
  }
}

async function bootstrap(): Promise<void> {
  const databaseUrl = process.env.EVAL_PROJECT_READ_DB_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("eval_project_read_http_server requires EVAL_PROJECT_READ_DB_URL");
  }
  const tenantId = process.env.EVAL_TENANT_ID;
  if (tenantId === undefined || tenantId.length === 0) {
    throw new Error("eval_project_read_http_server requires EVAL_TENANT_ID");
  }
  const httpPort = process.env.HTTP_PORT;
  if (httpPort === undefined || httpPort.length === 0) {
    throw new Error("eval_project_read_http_server requires HTTP_PORT");
  }

  const store = new PostgresOrchestrationStoreProvider({
    authentication: "static",
    connectionString: databaseUrl,
    migrationsFolder: `${__dirname}/drizzle`,
  });
  await store.migrate();

  const app = await NestFactory.create<NestFastifyApplication>(
    EvalProjectReadModule.register(store),
    new FastifyAdapter(),
  );
  const actorContext = evalAuthActorContext(tenantId);
  app.getHttpAdapter().getInstance().addHook(
    "onRequest",
    (request: SessionGatewayRequest, _reply: unknown, done: () => void) => {
      request.actorContext = actorContext;
      done();
    },
  );
  app.enableShutdownHooks();
  await app.listen(Number(httpPort), "127.0.0.1");
}

void bootstrap();
