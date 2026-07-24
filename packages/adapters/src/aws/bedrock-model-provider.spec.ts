import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  assertProviderContractParity,
  createMockModelProvider,
  modelProviderContract,
  type ModelProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  AwsBedrockModelProvider,
  BEDROCK_CAPABILITIES,
  type BedrockRuntimeCommandClient,
} from "./bedrock-model-provider";

const FIXED_CHECKED_AT = "2026-07-24T00:00:00.000Z";

function baseConfig() {
  return { region: "ap-south-1" };
}

function request(overrides: Partial<Parameters<AwsBedrockModelProvider["invoke"]>[0]> = {}) {
  return {
    tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
    runId: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
    nodeExecutionId: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
    modelId: "anthropic.claude-sonnet-5",
    capabilityTags: ["general"],
    inputJson: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    ...overrides,
  };
}

function realProvider(): ModelProvider {
  const send = vi.fn(async (command: ConverseCommand) => {
    expect(command.input.modelId).toBeDefined();
    return {
      output: { message: { content: [{ text: "hi there" }] } },
      stopReason: "end_turn",
      usage: { inputTokens: 3, outputTokens: 4 },
    };
  });
  return new AwsBedrockModelProvider(
    baseConfig(),
    { send } as unknown as BedrockRuntimeCommandClient,
    () => new Date(FIXED_CHECKED_AT),
  );
}

function equivalentMockProvider(): ModelProvider {
  return createMockModelProvider({
    capabilities: BEDROCK_CAPABILITIES,
    health: {
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: { configured: true },
    },
    invoke: async () => ({
      outputJson: JSON.stringify({
        message: { role: "assistant", content: "hi there" },
        stop_reason: "end_turn",
      }),
      usageJson: JSON.stringify({ input_tokens: 3, output_tokens: 4 }),
    }),
  });
}

describe("AwsBedrockModelProvider", () => {
  it("invokes Converse and maps the response to the shared invocation contract", async () => {
    const send = vi.fn(async (command: ConverseCommand) => {
      expect(command.input.modelId).toBe("anthropic.claude-sonnet-5");
      expect(command.input.messages).toEqual([
        { role: "user", content: [{ text: "hello" }] },
      ]);
      return {
        output: { message: { content: [{ text: "hi there" }] } },
        stopReason: "end_turn",
        usage: { inputTokens: 3, outputTokens: 4 },
      };
    });
    const provider = new AwsBedrockModelProvider(baseConfig(), {
      send,
    } as unknown as BedrockRuntimeCommandClient);

    const result = await provider.invoke(request());

    expect(JSON.parse(result.outputJson)).toEqual({
      message: { role: "assistant", content: "hi there" },
      stop_reason: "end_turn",
    });
    expect(JSON.parse(result.usageJson)).toEqual({
      input_tokens: 3,
      output_tokens: 4,
    });
  });

  it("separates system messages from the conversation and forwards inference params", async () => {
    const send = vi.fn(async (command: ConverseCommand) => {
      expect(command.input.system).toEqual([{ text: "be terse" }]);
      expect(command.input.messages).toEqual([
        { role: "user", content: [{ text: "hello" }] },
      ]);
      expect(command.input.inferenceConfig).toEqual({
        maxTokens: 256,
        temperature: 0.2,
      });
      return {
        output: { message: { content: [{ text: "ok" }] } },
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });
    const provider = new AwsBedrockModelProvider(baseConfig(), {
      send,
    } as unknown as BedrockRuntimeCommandClient);

    await provider.invoke(
      request({
        inputJson: JSON.stringify({
          messages: [
            { role: "system", content: "be terse" },
            { role: "user", content: "hello" },
          ],
          max_tokens: 256,
          temperature: 0.2,
        }),
      }),
    );
  });

  it("throws when Bedrock returns no message text content", async () => {
    const send = vi.fn(async () => ({ output: { message: { content: [] } } }));
    const provider = new AwsBedrockModelProvider(baseConfig(), {
      send,
    } as unknown as BedrockRuntimeCommandClient);

    await expect(provider.invoke(request())).rejects.toThrow(
      /no message text content/,
    );
  });

  it("defaults missing stop reason and usage fields", async () => {
    const send = vi.fn(async () => ({
      output: { message: { content: [{ text: "ok" }] } },
    }));
    const provider = new AwsBedrockModelProvider(baseConfig(), {
      send,
    } as unknown as BedrockRuntimeCommandClient);

    const result = await provider.invoke(request());
    expect(JSON.parse(result.outputJson)).toMatchObject({
      stop_reason: "unknown",
    });
    expect(JSON.parse(result.usageJson)).toEqual({
      input_tokens: 0,
      output_tokens: 0,
    });
  });

  it("reports healthy without spending on a real model invocation", async () => {
    const send = vi.fn();
    const provider = new AwsBedrockModelProvider(baseConfig(), {
      send,
    } as unknown as BedrockRuntimeCommandClient);

    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "healthy",
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("ModelProvider contract", () => {
  it("passes the unmodified shared contract suite with the real Bedrock adapter", async () => {
    const report = await assertProviderContractParity(modelProviderContract, [
      { name: "bedrock-primary", create: realProvider },
      { name: "bedrock-parity", create: realProvider },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(4);
  });

  it("passes the unmodified shared contract suite across the real adapter and the mock", async () => {
    const report = await assertProviderContractParity(modelProviderContract, [
      { name: "bedrock-real", create: realProvider },
      { name: "bedrock-mock", create: equivalentMockProvider },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(4);
  });
});
