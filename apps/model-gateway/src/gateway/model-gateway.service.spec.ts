import { createMockConfigProvider, createMockModelProvider } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import { ModelGatewayService } from "./model-gateway.service";

function request(overrides: Partial<Parameters<ModelGatewayService["invoke"]>[0]> = {}) {
  return {
    tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
    run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
    node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
    model_alias: "STANDARD",
    input_json: JSON.stringify({ prompt: "hello" }),
    ...overrides,
  };
}

describe("ModelGatewayService", () => {
  it("resolves the alias via config only and delegates the call to the model provider", async () => {
    const configProvider = createMockConfigProvider();
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const service = new ModelGatewayService(configProvider, modelProvider);

    const response = await service.invoke(request());

    expect(invoke).toHaveBeenCalledWith({
      tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
      runId: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
      nodeExecutionId: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
      modelId: "mock.standard.v1",
      capabilityTags: ["general"],
      inputJson: JSON.stringify({ prompt: "hello" }),
    });
    expect(response.resolved_capability).toBe("STANDARD");
    expect(JSON.parse(response.output_json)).toEqual({
      echo: { prompt: "hello" },
    });
  });

  it("resolves a different model per alias tier -- never a hardcoded model", async () => {
    const configProvider = createMockConfigProvider();
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const service = new ModelGatewayService(configProvider, modelProvider);

    await service.invoke(request({ model_alias: "CEILING" }));

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "mock.ceiling.v1" }),
    );
  });

  it("rejects a model_alias that is not one of the four tiers", async () => {
    const service = new ModelGatewayService(
      createMockConfigProvider(),
      createMockModelProvider(),
    );

    await expect(
      service.invoke(request({ model_alias: "ULTRA" })),
    ).rejects.toThrow(/not a recognized alias tier/);
  });
});
