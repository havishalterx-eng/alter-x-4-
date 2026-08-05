import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemHealthController } from "./system-health.controller";
import { SystemHealthService } from "./system-health.service";

describe("GET /system/service-health", () => {
  let app: NestFastifyApplication;
  const health = {
    getHealth: vi.fn(async () => ({
      status: "degraded" as const,
      services: [{ name: "model-gateway", status: "down" as const, latency_ms: 25 }],
    })),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SystemHealthController],
      providers: [{ provide: SystemHealthService, useValue: health }],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it("returns real aggregate health at documented system service-health route", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/system/service-health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "degraded",
      services: [{ name: "model-gateway", status: "down", latency_ms: 25 }],
    });
    expect(health.getHealth).toHaveBeenCalledOnce();
  });
});
