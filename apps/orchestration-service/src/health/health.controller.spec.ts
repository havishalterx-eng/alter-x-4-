import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module";

describe("GET /health", () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const config = {
      NODE_ENV: "production",
      INGRESS_SESSION_GATEWAY_CORE_ENABLED: "true",
      AUTH0_DOMAIN: "tenant.auth0.com",
      AUTH0_API_AUDIENCE: "alter-engine",
      ACTOR_TOKEN_ISSUER: "alter-platform-api.identity-broker",
      ACTOR_TOKEN_AUDIENCE: "alter-engine",
      ACTOR_TOKEN_JWKS_URL: "https://identity.example.test/actor-jwks",
      REDIS_ENDPOINT: "redis://localhost:6379",
      ORCHESTRATION_DATABASE_HOST: "localhost",
      ORCHESTRATION_DATABASE_PORT: "5432",
      ORCHESTRATION_DATABASE_NAME: "orchestration_db",
      ORCHESTRATION_DATABASE_USER: "orchestration_service",
      AWS_REGION: "ap-south-1",
      ALTER_ENV: "prod",
      MODEL_GATEWAY_ADDRESS: "127.0.0.1:50051",
      WHATSAPP_APP_SECRET: "test-app-secret",
      WHATSAPP_VERIFY_TOKEN: "test-verify-token",
      WHATSAPP_TENANT_ID: "00000000-0000-7000-8000-000000000001",
      WHATSAPP_WORKSPACE_ID: "00000000-0000-7000-8000-000000000011",
      TEMPORAL_ADDRESS: "127.0.0.1:7233",
      TEMPORAL_NAMESPACE: "default",
      CONVERSATION_LIFECYCLE_TASK_QUEUE: "conversation-lifecycle",
    };
    for (const [name, value] of Object.entries(config)) {
      vi.stubEnv(name, value);
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("returns health without authentication through the global guard", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "orchestration-service",
    });
  });
});
