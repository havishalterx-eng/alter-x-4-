import {
  createMockConfigProvider,
  createMockModelProvider,
  createMockPIIRedactionProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import { ModelGatewayService } from "./model-gateway.service";

function request(overrides: Partial<Parameters<ModelGatewayService["invoke"]>[0]> = {}) {
  return {
    tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
    run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
    node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
    model_alias: "STANDARD",
    input_json: JSON.stringify({
      messages: [{ role: "user", content: "hello" }],
    }),
    ...overrides,
  };
}

describe("ModelGatewayService", () => {
  it("resolves the alias via config only and delegates the call to the model provider", async () => {
    const configProvider = createMockConfigProvider();
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const service = new ModelGatewayService(
      configProvider,
      modelProvider,
      createMockPIIRedactionProvider(),
    );

    const response = await service.invoke(request());

    expect(invoke).toHaveBeenCalledWith({
      tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
      runId: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
      nodeExecutionId: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
      modelId: "mock.standard.v1",
      capabilityTags: ["general"],
      inputJson: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(response.resolved_capability).toBe("STANDARD");
    expect(JSON.parse(response.output_json)).toEqual({
      message: {
        role: "assistant",
        content: "mock response to: hello",
      },
      stop_reason: "end_turn",
    });
  });

  it("resolves a different model per alias tier -- never a hardcoded model", async () => {
    const configProvider = createMockConfigProvider();
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const service = new ModelGatewayService(
      configProvider,
      modelProvider,
      createMockPIIRedactionProvider(),
    );

    await service.invoke(request({ model_alias: "CEILING" }));

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "mock.ceiling.v1" }),
    );
  });

  it("rejects a model_alias that is not one of the four tiers", async () => {
    const service = new ModelGatewayService(
      createMockConfigProvider(),
      createMockModelProvider(),
      createMockPIIRedactionProvider(),
    );

    await expect(
      service.invoke(request({ model_alias: "ULTRA" })),
    ).rejects.toThrow(/not a recognized alias tier/);
  });

  it("redacts PII out of input_json before it reaches the model provider -- GATE-1's outbound path", async () => {
    const configProvider = createMockConfigProvider();
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const piiRedactionProvider = createMockPIIRedactionProvider();
    const service = new ModelGatewayService(
      configProvider,
      modelProvider,
      piiRedactionProvider,
    );

    await service.invoke(
      request({
        input_json: JSON.stringify({
          messages: [{ role: "user", content: "my PAN is ABCDE1234F" }],
        }),
      }),
    );

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        inputJson: JSON.stringify({
          messages: [{ role: "user", content: "my PAN is <IN_PAN>" }],
        }),
      }),
    );
  });

  it("redact() delegates to the PIIRedactionProvider and reports a redaction count", async () => {
    const service = new ModelGatewayService(
      createMockConfigProvider(),
      createMockModelProvider(),
      createMockPIIRedactionProvider(),
    );

    const response = await service.redact({
      tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
      run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
      content: "PAN on file: ABCDE1234F",
    });

    expect(response).toEqual({
      redacted_content: "PAN on file: <IN_PAN>",
      redaction_count: 1,
    });
  });

  it("redact() returns the text unchanged and a zero count when no PII is present", async () => {
    const service = new ModelGatewayService(
      createMockConfigProvider(),
      createMockModelProvider(),
      createMockPIIRedactionProvider(),
    );

    const response = await service.redact({
      tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
      run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
      content: "nothing sensitive here",
    });

    expect(response).toEqual({
      redacted_content: "nothing sensitive here",
      redaction_count: 0,
    });
  });
});
