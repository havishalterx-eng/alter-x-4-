import { describe, expect, it, vi } from "vitest";
import type { SecretsProvider } from "@alterx/shared-clients";
import { AuditEventsClient } from "./audit-events-client";
import type { EngineConfig } from "./config";

const config: EngineConfig = {
  baseUrl: "https://engine.test",
  adsCoreBaseUrl: "https://ads.test",
  costLedgerBaseUrl: "https://costs.test",
  auditServiceBaseUrl: "https://audit.test/",
  auditQueryServiceTokenRef: "env:AUDIT_QUERY_TOKEN",
  evalServiceGrpcTarget: "eval-service:50062",
  m2mTokenUrl: "https://identity.test/oauth/token",
  m2mAudience: "https://engine.test",
  m2mClientId: "platform-api",
  m2mClientSecretRef: "env:ENGINE_SECRET",
  requestTimeoutMs: 100,
};

describe("AuditEventsClient", () => {
  it("resolves the service token by reference and sends it only to the internal route", async () => {
    const secrets = { getSecret: vi.fn().mockResolvedValue("private-service-token") } as unknown as SecretsProvider;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, page()));
    const client = new AuditEventsClient(config, secrets, fetchImpl);

    const result = await client.query({
      tenantId: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
      actorTypes: ["user", "support"],
      limit: 20,
    });

    expect(secrets.getSecret).toHaveBeenCalledWith("env:AUDIT_QUERY_TOKEN");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://audit.test/internal/audit-events?tenant_id=ten_018f47a5-7b2c-7d10-8f11-123456789abc&actor_types=user%2Csupport&limit=20",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer private-service-token" }) }),
    );
    expect(result).toEqual(page());
    expect(JSON.stringify(result)).not.toContain("private-service-token");
  });

  it("fails closed when token resolution, upstream status, or body validation fails", async () => {
    const unavailable = new AuditEventsClient(
      config,
      { getSecret: vi.fn().mockRejectedValue(new Error("unavailable")) } as unknown as SecretsProvider,
      vi.fn(),
    );
    await expect(unavailable.query({})).rejects.toMatchObject({ problem: { status: 502 } });

    const invalid = new AuditEventsClient(
      config,
      { getSecret: vi.fn().mockResolvedValue("token") } as unknown as SecretsProvider,
      vi.fn().mockResolvedValue(jsonResponse(200, { events: [{ nope: true }], next_cursor: null })),
    );
    await expect(invalid.query({})).rejects.toMatchObject({ problem: { status: 502 } });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function page() {
  return {
    events: [{
      id: "aud_018f47a5-7b2c-7d10-8f11-123456789abc",
      actor_type: "user",
      actor_ref: "usr_1",
      action: "workflow.create",
      target_type: "workflow",
      target_ref: "wf_1",
      result: "success",
      reason_code: "",
      context_json: "",
      occurred_at: "2026-08-05T00:00:00.000Z",
      entry_hash: "a".repeat(64),
    }],
    next_cursor: null,
  };
}
