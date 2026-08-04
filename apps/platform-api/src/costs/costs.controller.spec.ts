import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CostLedgerClient, EngineExceptionFilter } from "../engine";
import { RbacModule, type ActorContextType, type RbacRequest } from "../rbac";
import { CostsController } from "./costs.controller";
import { CostsExceptionFilter } from "./costs-exception.filter";
import { CostsService } from "./costs.service";

const actor: ActorContextType = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session-a",
  roles: ["viewer"],
  permissions: ["billing:read"],
};

describe("CostsController", () => {
  let app: NestFastifyApplication;
  const ledger = { getSummary: vi.fn(), estimate: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [CostsController],
      providers: [
        CostsService,
        CostsExceptionFilter,
        { provide: CostLedgerClient, useValue: ledger },
        { provide: APP_FILTER, useClass: EngineExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.getHttpAdapter().getInstance().addHook("preHandler", (request: FastifyRequest, _reply: unknown, done: () => void) => {
      const value = request.headers["x-test-actor"];
      if (typeof value === "string") (request as RbacRequest).actorContext = JSON.parse(value) as ActorContextType;
      done();
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    ledger.getSummary.mockReset();
    ledger.estimate.mockReset();
  });

  afterAll(async () => app.close());

  it("uses actor tenant/workspace, ignores raw tenant query, returns empty real state", async () => {
    ledger.getSummary.mockResolvedValue(emptyRollup());
    const response = await request("GET", "/api/v1/costs/summary?tenantId=ten_other&startAt=2026-01-01T00%3A00%3A00.000Z&endAt=2026-02-01T00%3A00%3A00.000Z", actor);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ groups: [], totals: { internalCostMinor: "0" } });
    expect(ledger.getSummary).toHaveBeenCalledWith(
      { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-02-01T00:00:00.000Z", dimensions: [] },
      expect.objectContaining({ tenantId: actor.tenant_id, workspaceId: actor.workspace_id }),
    );
  });

  it("blocks cross-tenant data access without billing permission", async () => {
    const response = await request("GET", "/api/v1/costs/summary?startAt=2026-01-01T00%3A00%3A00.000Z&endAt=2026-02-01T00%3A00%3A00.000Z", { ...actor, permissions: [] });
    expectProblem(response, 403, "RBAC_PERMISSION_DENIED");
    expect(ledger.getSummary).not.toHaveBeenCalled();
  });

  it("returns 502 problem for malformed upstream rollups", async () => {
    ledger.getSummary.mockResolvedValue("bad-json");
    const response = await request("GET", "/api/v1/costs/summary?startAt=2026-01-01T00%3A00%3A00.000Z&endAt=2026-02-01T00%3A00%3A00.000Z", actor);
    expectProblem(response, 502, "INVALID_COST_ROLLUP_RESPONSE");
  });

  it("validates and relays estimate without client-controlled tenant", async () => {
    ledger.estimate.mockResolvedValue(estimate());
    const response = await request("POST", "/api/v1/costs/estimate", actor, {
      mode: "workflow",
      lineItems: [{ source: "model_gateway", provider: "bedrock", resource: "claude", expectedQuantity: 1 }],
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(estimate());
    expect(ledger.estimate).toHaveBeenCalledWith(
      expect.not.objectContaining({ tenantId: expect.anything() }),
      expect.objectContaining({ tenantId: actor.tenant_id }),
    );
  });

  function request(method: "GET" | "POST", url: string, requestActor: ActorContextType, payload?: unknown): Promise<TestResponse> {
    return app.getHttpAdapter().getInstance().inject({
      method, url,
      headers: { "x-test-actor": JSON.stringify(requestActor), ...(payload ? { "content-type": "application/json" } : {}) },
      ...(payload ? { payload: JSON.stringify(payload) } : {}),
    }) as Promise<TestResponse>;
  }
});

interface TestResponse { statusCode: number; headers: Record<string, string | string[] | undefined>; json(): unknown; }

function emptyRollup(): string {
  return JSON.stringify({
    start_at: "2026-01-01T00:00:00.000Z", end_at: "2026-02-01T00:00:00.000Z",
    dimensions: [], groups: [],
    totals: { internal_cost_minor: "0", billable_minor: "0", margin_minor: "0" },
  });
}

function estimate(): unknown {
  return {
    currency: "INR", lineItems: [{ source: "model_gateway", provider: "bedrock", resource: "claude", expectedQuantity: 1, confidence: "no_data", sampleSize: 0, historicalUnitCostMinor: null, estimatedBaseCostMinor: "0", historicalRetryRate: 0, estimatedRetryCostMinor: "0", estimatedTotalCostMinor: "0" }],
    totalEstimatedInternalCostMinor: "0", hasUnestimatedLineItems: true,
  };
}

function expectProblem(response: TestResponse, status: number, errorCode: string): void {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toMatchObject({ status, error_code: errorCode });
}
