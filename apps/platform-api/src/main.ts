import "reflect-metadata";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { validatePlatformApiEnv } from "./config/env.schema";

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}

async function bootstrap(): Promise<void> {
  validatePlatformApiEnv(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { rawBody: true },
  );
  // Fastify decorates the request prototype for performance; a plain
  // `request.actorContext = ...` assignment made in SignupActorContextMiddleware
  // (a NestJS middleware, i.e. an onRequest-phase hook) did not reliably
  // survive through to guards (a later phase) without first registering the
  // property here. Without this, every RequireWorkspaceRole/RequireTenantRole
  // check saw actorContext as undefined and failed closed with
  // RBAC_ROLE_DENIED even when the middleware had just set it correctly.
  app.getHttpAdapter().getInstance().decorateRequest("actorContext", null);
  await app.listen(parsePort(process.env.PORT), "0.0.0.0");
}

void bootstrap();
