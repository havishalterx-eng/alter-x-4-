import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CostRollupService } from "./cost-rollup.service";
import { CostSummaryController } from "./cost-summary.controller";

describe("CostSummaryController", () => {
  let app: NestFastifyApplication;
  const rollups = { queryRollups: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CostSummaryController],
      providers: [{ provide: CostRollupService, useValue: rollups }],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app.close());

  it("passes exact scoped QueryRollups input to real service", async () => {
    rollups.queryRollups.mockResolvedValue({ rollups_json: "{}" });
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/costs/summary?tenantId=ten_018f47a5-7b2c-7d10-8f11-123456789abc&workspaceId=ws_018f47a5-7b2c-7d10-8f11-123456789abc&startAt=2026-01-01T00%3A00%3A00.000Z&endAt=2026-02-01T00%3A00%3A00.000Z&dimensions=mode&dimensions=provider",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ rollups_json: "{}" });
    expect(rollups.queryRollups).toHaveBeenCalledWith({
      tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
      workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
      start_at: "2026-01-01T00:00:00.000Z",
      end_at: "2026-02-01T00:00:00.000Z",
      dimensions: ["mode", "provider"],
    });
  });

  it("rejects incomplete query before calling rollup service", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/costs/summary?tenantId=ten_018f47a5-7b2c-7d10-8f11-123456789abc",
    });
    expect(response.statusCode).toBe(400);
  });
});
