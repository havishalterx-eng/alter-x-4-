import {
  createMockConfigProvider,
  createMockMutableParameterStoreProvider,
} from "@alterx/shared-clients";
import { describe, expect, it } from "vitest";
import { OperationalConfigProvider } from "./operational-config-provider";

describe("OperationalConfigProvider", () => {
  it("stages model aliases without changing the live policy", async () => {
    const store = createMockMutableParameterStoreProvider({
      parameters: {
        "/alter/prod/model-gateway/model-policy": JSON.stringify({
          version: "live-v1",
          bindings: {
            FAST: { model_id: "mock.fast.v1", capability_tags: [], fallback_chain: [] },
            STANDARD: { model_id: "mock.standard.v1", capability_tags: [], fallback_chain: [] },
            ADVANCED: { model_id: "mock.advanced.v1", capability_tags: [], fallback_chain: [] },
            CEILING: { model_id: "mock.ceiling.v1", capability_tags: [], fallback_chain: [] },
          },
        }),
      },
    });
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

    const proposed = await writer.proposeModelAlias("STANDARD", binding);

    await expect(store.getParameter(parameterName)).resolves.toMatch(/live-v1/);
    await expect(store.getParameter(`${parameterName}/pending`)).resolves
      .toBe(JSON.stringify(proposed));

    const reader = new OperationalConfigProvider(
      createMockConfigProvider(),
      store,
      parameterName,
    );
    await expect(reader.resolveModelAlias("STANDARD")).resolves.toMatchObject({
      model_id: "mock.standard.v1",
    });
  });

  it("promotes the staged policy and clears the pending parameter", async () => {
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

    const proposed = await writer.proposeModelAlias("STANDARD", binding);
    await expect(writer.promoteModelAlias()).resolves.toEqual(proposed);
    await expect(store.getParameter(parameterName)).resolves.toBe(JSON.stringify(proposed));
    await expect(store.getParameter(`${parameterName}/pending`)).rejects.toThrow("not found");

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

  it("rejects promotion when no proposal is staged", async () => {
    const provider = new OperationalConfigProvider(
      createMockConfigProvider(),
      createMockMutableParameterStoreProvider(),
      "/policy",
    );
    await expect(provider.promoteModelAlias()).rejects.toThrow("No pending model policy");
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
