import { describe, expect, it, vi } from "vitest";
import { DeploymentAdminClient } from "./deployment-admin-client";
import type { EngineConfig } from "./config";

const config: EngineConfig = {
  baseUrl: "https://engine.test",
  adsCoreBaseUrl: "https://ads.test",
  costLedgerBaseUrl: "https://cost.test",
  evalFacadeTokenRef: "env:EVAL",
  deploymentAdminServiceTokenRef: "env:DEPLOYMENT_ADMIN",
  auditServiceBaseUrl: "https://audit.test",
  auditQueryServiceTokenRef: "env:AUDIT",
  m2mTokenUrl: "https://identity.test/token",
  m2mAudience: "engine",
  m2mClientId: "platform",
  m2mClientSecretRef: "env:M2M",
  requestTimeoutMs: 5000,
};
const input = {
  tenant_id: "018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  deployment_id: "dep_018f4d6e-2b4a-7a3e-8c1a-1234567890a2",
  action: "suspend" as const,
  reason: "incident",
};

describe("DeploymentAdminClient", () => {
  it("resolves credential and calls authenticated internal HTTP route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tenant_id: input.tenant_id,
      deployment_id: input.deployment_id,
      action: input.action,
      project_id: "prj_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
      status: "suspended",
      active_deployment_id: null,
      updated_at: "2026-08-06T12:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const resolveSecret = vi.fn().mockResolvedValue("real-secret");
    const client = new DeploymentAdminClient(config, resolveSecret, fetchImpl);
    await expect(client.apply(input, "00-trace-parent")).resolves.toMatchObject({ status: "suspended" });
    expect(resolveSecret).toHaveBeenCalledWith("env:DEPLOYMENT_ADMIN");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://engine.test/internal/admin/deployments/actions/apply",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer real-secret",
          traceparent: "00-trace-parent",
        }),
      }),
    );
  });

  it("rejects malformed successful upstream response", async () => {
    const client = new DeploymentAdminClient(config, async () => "secret", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "suspended" }), { status: 200 }),
    ));
    await expect(client.apply(input, undefined)).rejects.toMatchObject({ response: expect.objectContaining({ status: 502 }) });
  });

  it("maps internal credential rejection to upstream failure", async () => {
    const client = new DeploymentAdminClient(config, async () => "stale", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 401 }), { status: 401 }),
    ));
    await expect(client.apply(input, undefined)).rejects.toMatchObject({
      response: expect.objectContaining({ status: 502, error_code: "UPSTREAM_SERVICE_ERROR" }),
    });
  });

  it("maps secret resolution and ordinary upstream failures", async () => {
    const unavailableSecret = new DeploymentAdminClient(config, async () => {
      throw new Error("secret store unavailable");
    });
    await expect(unavailableSecret.apply(input, undefined)).rejects.toMatchObject({
      response: expect.objectContaining({ status: 502, error_code: "UPSTREAM_SERVICE_ERROR" }),
    });

    const rejected = new DeploymentAdminClient(config, async () => "secret", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        type: "https://errors.alter.ai/validation-error",
        title: "VALIDATION_ERROR",
        status: 400,
        detail: "invalid deployment state",
        instance: "/wrong",
        error_code: "VALIDATION_ERROR",
        trace_id: "trc_1",
        request_id: "req_1",
        retryable: false,
        field_errors: [],
        documentation_key: "validation.error",
      }), { status: 400, headers: { "content-type": "application/problem+json" } }),
    ));
    await expect(rejected.apply(input, undefined)).rejects.toMatchObject({
      response: expect.objectContaining({ status: 400, error_code: "UPSTREAM_SERVICE_ERROR" }),
    });
  });

  it("maps an aborted request to an upstream timeout", async () => {
    const abortError = Object.assign(new Error("deadline exceeded"), { name: "AbortError" });
    const client = new DeploymentAdminClient(config, async () => "secret", vi.fn().mockRejectedValue(abortError));

    await expect(client.apply(input, undefined)).rejects.toMatchObject({
      response: expect.objectContaining({ status: 504, error_code: "UPSTREAM_TIMEOUT" }),
    });
  });
});
