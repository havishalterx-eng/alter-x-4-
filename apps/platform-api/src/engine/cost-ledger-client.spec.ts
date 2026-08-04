import { describe, expect, it, vi } from "vitest";

import type { EngineAuthProvider } from "./auth";
import { CostLedgerClient } from "./cost-ledger-client";
import type { EngineConfig } from "./config";
import type { EngineCallerContext } from "./types";

const config: EngineConfig = {
  baseUrl: "https://engine.test",
  costLedgerBaseUrl: "https://costs.test/",
  m2mTokenUrl: "https://identity.test/oauth/token",
  m2mAudience: "https://engine.test",
  m2mClientId: "platform-api",
  m2mClientSecretRef: "env:ENGINE_SECRET",
  requestTimeoutMs: 100,
};

const context: EngineCallerContext = {
  userId: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenantId: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspaceId: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  sessionId: "session-1",
  authTime: 1_700_000_000,
  roles: ["viewer"],
  permissions: ["runs:read"],
  traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
};

const runId = "run_018f47a5-7b2c-7d10-8f11-123456789abc";

describe("CostLedgerClient", () => {
  it("gets the real scoped route and returns only validated node costs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {
      node_costs: [
        {
          node_execution_id: "node_018f47a5-7b2c-7d10-8f11-123456789abd",
          internal_cost_minor: "37",
          event_count: 2,
        },
      ],
    }));
    const client = new CostLedgerClient(config, authProvider(), fetchImpl);

    await expect(client.getNodeCosts(runId, context)).resolves.toEqual([
      {
        nodeExecutionId: "node_018f47a5-7b2c-7d10-8f11-123456789abd",
        internalCostMinor: "37",
        eventCount: 2,
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://costs.test/costs/by-run/${runId}?tenantId=${context.tenantId}&workspaceId=${context.workspaceId}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer m2m-token",
          "X-Alter-Actor-Token": "actor-token",
          traceparent: context.traceparent,
        }),
      }),
    );
  });

  it("fails closed for malformed cost payloads and non-success responses", async () => {
    const malformed = new CostLedgerClient(
      config,
      authProvider(),
      vi.fn().mockResolvedValue(jsonResponse(200, { node_costs: [{ nope: true }] })),
    );
    await expect(malformed.getNodeCosts(runId, context)).rejects.toMatchObject({
      problem: { status: 502, error_code: "UPSTREAM_SERVICE_ERROR" },
    });

    const unavailable = new CostLedgerClient(
      config,
      authProvider(),
      vi.fn().mockResolvedValue(jsonResponse(503, {})),
    );
    await expect(unavailable.getNodeCosts(runId, context)).rejects.toMatchObject({
      problem: { status: 503, error_code: "UPSTREAM_SERVICE_ERROR" },
    });
  });

  it("fails closed when authorization or transport fails", async () => {
    const authFailure = new CostLedgerClient(
      config,
      { authorize: vi.fn().mockRejectedValue(new Error("unavailable")) },
      vi.fn(),
    );
    await expect(authFailure.getNodeCosts(runId, context)).rejects.toMatchObject({
      problem: { status: 502 },
    });

    const transportFailure = new CostLedgerClient(
      config,
      authProvider(),
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    await expect(transportFailure.getNodeCosts(runId, context)).rejects.toMatchObject({
      problem: { status: 502 },
    });
  });
});

function authProvider(): EngineAuthProvider {
  return {
    authorize: vi.fn().mockResolvedValue({
      m2mAccessToken: "m2m-token",
      actorToken: "actor-token",
    }),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
