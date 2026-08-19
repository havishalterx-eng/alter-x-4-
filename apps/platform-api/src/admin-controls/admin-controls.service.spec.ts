import { describe, expect, it, vi } from "vitest";
import { AdminAuditService } from "../admin-audit";
import { AdminControlsService } from "./admin-controls.service";
import { FeatureFlagRepository } from "./feature-flag.repository";
import { ModelGatewayAdminClient } from "./model-gateway-admin.client";

describe("AdminControlsService", () => {
  it("uses separate stores and audits every control write", async () => {
    const provider = {
      provider_id: "aws-bedrock",
      interface_name: "ModelProvider",
      health: "healthy" as const,
      checked_at: "2026-08-06T10:00:00.000Z",
      latency_ms: 4,
      active: false,
      configuration_revision: "rev-2",
      fallback_chain: ["anthropic-direct"],
    };
    const updateProvider = vi.fn().mockResolvedValue(provider);
    const proposeModelAlias = vi.fn().mockResolvedValue({
      version: "policy-v2",
      bindings: {
        FAST: { model_id: "mock.fast.v1", capability_tags: [], fallback_chain: [] },
        STANDARD: { model_id: "mock.standard.v1", capability_tags: [], fallback_chain: [] },
        ADVANCED: { model_id: "mock.advanced.v1", capability_tags: [], fallback_chain: [] },
        CEILING: { model_id: "mock.ceiling.v1", capability_tags: [], fallback_chain: [] },
      },
    });
    const promoteModelAlias = vi.fn().mockResolvedValue({
      version: "policy-v2",
      bindings: {
        FAST: { model_id: "mock.fast.v1", capability_tags: [], fallback_chain: [] },
        STANDARD: { model_id: "mock.standard.v1", capability_tags: [], fallback_chain: [] },
        ADVANCED: { model_id: "mock.advanced.v1", capability_tags: [], fallback_chain: [] },
        CEILING: { model_id: "mock.ceiling.v1", capability_tags: [], fallback_chain: [] },
      },
    });
    const upsert = vi.fn().mockResolvedValue({
      name: "operations.kill-switch",
      enabled: true,
      description: "Stop new deployments",
      revision: 1,
      updated_at: "2026-08-06T10:00:00.000Z",
      updated_by: "stf_admin",
    });
    const record = vi.fn().mockResolvedValue("a".repeat(64));
    const service = new AdminControlsService(
      { updateProvider, proposeModelAlias, promoteModelAlias } as unknown as ModelGatewayAdminClient,
      { upsert } as unknown as FeatureFlagRepository,
      { record } as unknown as AdminAuditService,
    );

    await expect(service.updateProvider("aws-bedrock", "stf_admin", {
      active: false,
      reason: "provider incident",
    })).resolves.toEqual(provider);
    await service.upsertFeatureFlag("operations.kill-switch", "stf_admin", {
      enabled: true,
      description: "Stop new deployments",
      reason: "incident response",
    });
    await service.proposeModelAlias("STANDARD", "stf_admin", {
      binding: { model_id: "mock.standard.v2", capability_tags: [], fallback_chain: [] },
      reason: "validated rollout",
    });
    await service.promoteModelAlias("stf_admin");

    expect(updateProvider).toHaveBeenCalledWith("aws-bedrock", {
      active: false,
      reason: "provider incident",
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(4);
    expect(record).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "provider.control.update",
      targetRef: "aws-bedrock",
    }));
    expect(record).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "policy.feature_flag.upsert",
      targetRef: "operations.kill-switch",
    }));
    expect(record).toHaveBeenNthCalledWith(3, expect.objectContaining({
      action: "policy.model_alias.propose",
      targetRef: "STANDARD",
    }));
    expect(record).toHaveBeenNthCalledWith(4, expect.objectContaining({
      action: "policy.model_alias.promote",
      targetRef: "pending",
    }));
  });
});
