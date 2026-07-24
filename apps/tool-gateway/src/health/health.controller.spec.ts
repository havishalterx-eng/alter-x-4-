import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import {
  createMockAuditEventHandler,
  createMockConfigProvider,
  createMockSearchProvider,
  createMockSecretsProvider,
} from "@alterx/shared-clients";
import { SsrfGuardedFetcher } from "@alterx/adapters";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";

describe("GET /health", () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
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
