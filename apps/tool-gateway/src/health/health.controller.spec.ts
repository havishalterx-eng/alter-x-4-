import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import {
  createMockAuditEventHandler,
  createMockCacheProvider,
  createMockConfigProvider,
  createMockQueueProvider,
  createMockSearchProvider,
  createMockSecretsProvider,
} from "@alterx/shared-clients";
import { SsrfGuardedFetcher, type DatabaseOperationProvider } from "@alterx/adapters";

const unexercisedDatabaseProvider: DatabaseOperationProvider = {
  providerId: "health-spec-unexercised",
  execute: () => {
    throw new Error("health.controller.spec.ts does not exercise database.* tool dispatch");
  },
};
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";

describe("GET /health", () => {
  let app: NestFastifyApplication;
  const originalAuth0Domain = process.env["AUTH0_DOMAIN"];
  const originalApiAudience = process.env["API_AUDIENCE"];

  beforeEach(async () => {
    process.env["AUTH0_DOMAIN"] = "auth0.test";
    process.env["API_AUDIENCE"] = "alterx-test";
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register(
          createMockConfigProvider(),
          createMockSecretsProvider(),
          createMockSearchProvider(),
          new SsrfGuardedFetcher(
            {},
            async () => [{ address: "93.184.216.34", family: 4 }],
            async () => ({
              status: 200,
              headers: { get: () => null },
              body: undefined,
              arrayBuffer: async () => new ArrayBuffer(0),
            }),
          ),
          createMockAuditEventHandler(),
          unexercisedDatabaseProvider,
          createMockQueueProvider(),
          "health-spec-cost-events",
          createMockCacheProvider(),
        ),
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
    if (originalAuth0Domain === undefined) {
      delete process.env["AUTH0_DOMAIN"];
    } else {
      process.env["AUTH0_DOMAIN"] = originalAuth0Domain;
    }
    if (originalApiAudience === undefined) {
      delete process.env["API_AUDIENCE"];
    } else {
      process.env["API_AUDIENCE"] = originalApiAudience;
    }
  });

  it("returns the service health response", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "tool-gateway",
    });
  });
});
