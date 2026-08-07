import {
  createMockConfigProvider,
  createMockMutableParameterStoreProvider,
} from "@alterx/shared-clients";
import { describe, expect, it } from "vitest";
import { OperationalConfigProvider } from "./operational-config-provider";

describe("OperationalConfigProvider", () => {
  it("persists model aliases and reloads them across replicas", async () => {
    const store = createMockMutableParameterStoreProvider();
    const parameterName = "/alter/prod/model-gateway/model-policy";
    const writer = new OperationalConfigProvider(
      createMockConfigProvider(),
      store,
      parameterName,
    );
    const binding = {
      model_id: "anthropic.claude-sonnet-5",
      capability_tags: ["general", "reasoning"],
      fallback_chain: [{ provider: "openai" as const, model_id: "gpt-5" }],
    };

    await writer.updateModelAlias("STANDARD", binding);

    const reader = new OperationalConfigProvider(
      createMockConfigProvider(),
      store,
      parameterName,
    );
    await expect(reader.resolveModelAlias("STANDARD")).resolves.toEqual(binding);
    await expect(reader.resolveModelAlias("FAST")).resolves.toMatchObject({
      model_id: "mock.fast.v1",
    });
  });

  it("keeps tool permissions and cost limits on baseline provider", async () => {
    const provider = new OperationalConfigProvider(
      createMockConfigProvider(),
      createMockMutableParameterStoreProvider(),
      "/policy",
    );
    await expect(provider.resolveToolPermission({
      tenantId: "tenant-1",
      toolName: "search",
    })).resolves.toMatchObject({ allowed: true });
    await expect(provider.resolveCostLimit({ tenantId: "tenant-1", runId: "run-1" }))
      .resolves.toMatchObject({ maxCostUsdPerCall: 5 });
  });
});
