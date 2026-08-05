import { describe, expect, it, vi } from "vitest";

import type { EngineConfig } from "./config";
import { EvalFacadeClient } from "./eval-facade-client";

const config: EngineConfig = {
  baseUrl: "https://engine.test/",
  adsCoreBaseUrl: "https://ads.test",
  costLedgerBaseUrl: "https://costs.test",
  evalFacadeTokenRef: "env:EVAL_FACADE_TOKEN",
  m2mTokenUrl: "https://identity.test/oauth/token",
  m2mAudience: "https://engine.test",
  m2mClientId: "platform-api",
  m2mClientSecretRef: "env:ENGINE_SECRET",
  requestTimeoutMs: 100,
};

describe("EvalFacadeClient", () => {
  it("relays the two live Eval requests over the internal HTTP facade", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        evaluation_run_id: "evr_1",
        status: "completed",
        results_json: "{}",
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        passed: true,
        failed_thresholds: [],
      }));
    const resolveSecret = vi.fn().mockResolvedValue("facade-token");
    const client = new EvalFacadeClient(config, resolveSecret, fetchImpl);

    await expect(client.runEvaluation(
      { golden_set_name: "planner" },
      "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    )).resolves.toEqual({
      evaluation_run_id: "evr_1",
      status: "completed",
      results_json: "{}",
    });
    await expect(client.checkReleaseGate({
      release_gate_key: "engine",
      evaluation_run_id: "evr_1",
    }, undefined)).resolves.toEqual({ passed: true, failed_thresholds: [] });

    expect(fetchImpl).toHaveBeenNthCalledWith(1,
      "https://engine.test/internal/eval/run-evaluation",
      expect.objectContaining({
        method: "POST",
        body: '{"golden_set_name":"planner"}',
        headers: expect.objectContaining({
          Authorization: "Bearer facade-token",
          traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(2,
      "https://engine.test/internal/eval/check-release-gate",
      expect.objectContaining({
        body: '{"release_gate_key":"engine","evaluation_run_id":"evr_1"}',
        headers: expect.objectContaining({ Authorization: "Bearer facade-token" }),
      }),
    );
    expect(resolveSecret).toHaveBeenCalledWith("env:EVAL_FACADE_TOKEN");
  });

  it("fails closed on missing secrets, unsafe facade authentication, bad responses, and transport errors", async () => {
    const secretFailure = new EvalFacadeClient(
      config,
      vi.fn().mockRejectedValue(new Error("missing")),
      vi.fn(),
    );
    await expect(secretFailure.runEvaluation({ golden_set_name: "planner" }, undefined))
      .rejects.toMatchObject({ problem: { status: 502, error_code: "UPSTREAM_SERVICE_ERROR" } });

    const rejected = new EvalFacadeClient(
      config,
      vi.fn().mockResolvedValue("facade-token"),
      vi.fn().mockResolvedValue(jsonResponse(401, {})),
    );
    await expect(rejected.runEvaluation({ golden_set_name: "planner" }, undefined))
      .rejects.toMatchObject({ problem: { status: 502, error_code: "UPSTREAM_SERVICE_ERROR" } });

    const malformed = new EvalFacadeClient(
      config,
      vi.fn().mockResolvedValue("facade-token"),
      vi.fn().mockResolvedValue(jsonResponse(200, { status: "completed" })),
    );
    await expect(malformed.runEvaluation({ golden_set_name: "planner" }, undefined))
      .rejects.toMatchObject({ problem: { status: 502, error_code: "UPSTREAM_SERVICE_ERROR" } });

    const unavailable = new EvalFacadeClient(
      config,
      vi.fn().mockResolvedValue("facade-token"),
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    await expect(unavailable.checkReleaseGate({ release_gate_key: "engine", evaluation_run_id: "evr_1" }, undefined))
      .rejects.toMatchObject({ problem: { status: 502, error_code: "UPSTREAM_SERVICE_ERROR" } });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
