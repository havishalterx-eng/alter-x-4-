import { describe, expect, it, vi } from "vitest";
import type { SecretsProvider } from "@alterx/shared-clients";
import { ModelGatewayAdminClient } from "./model-gateway-admin.client";

describe("ModelGatewayAdminClient", () => {
  it("fetches live provider state using secret-backed service authentication", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      provider_id: "aws-bedrock",
      interface_name: "ModelProvider",
      health: "healthy",
      checked_at: "2026-08-06T10:00:00.000Z",
      latency_ms: 3,
      active: true,
      configuration_revision: "rev-1",
      fallback_chain: ["anthropic-direct"],
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    const secrets = {
      getSecret: vi.fn().mockResolvedValue("service-token"),
    } as unknown as SecretsProvider;
    const client = new ModelGatewayAdminClient({
      baseUrl: "http://model-gateway.test",
      tokenSecretRef: "/alter/model-gateway/admin-token",
      timeoutMs: 1000,
    }, secrets, fetchImpl);

    await expect(client.listProviders()).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://model-gateway.test/internal/admin/providers",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer service-token" }),
      }),
    );
  });
});
