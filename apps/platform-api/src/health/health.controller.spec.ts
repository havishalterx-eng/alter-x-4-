import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";

describe("GET /health", () => {
  let app: NestFastifyApplication;
  const originalEnvironment = { ...process.env };

  beforeEach(async () => {
    process.env.DATABASE_URL =
      "postgres://platform_api:platform_api_local@localhost:5432/platform_db";
    process.env.NODE_ENV = "test";
    process.env.SIGNING_KEY_PROVIDER = "mock";
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
    process.env = { ...originalEnvironment };
  });

  it("returns the service health response", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "platform-api",
    });
  });
});
