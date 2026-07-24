import {
  assertProviderContractParity,
  createMockModelProvider,
  modelProviderContract,
  type ModelProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  OPENAI_CAPABILITIES,
  OpenAiModelProvider,
  type OpenAiChatCompletionsCommandClient,
} from "./openai-model-provider";

const FIXED_CHECKED_AT = "2026-07-24T00:00:00.000Z";

function request(overrides: Partial<Parameters<OpenAiModelProvider["invoke"]>[0]> = {}) {
  return {
    tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
    runId: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
    nodeExecutionId: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
    modelId: "gpt-5",
    capabilityTags: ["general"],
    inputJson: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    ...overrides,
  };
}

function realProvider(): ModelProvider {
  const create = vi.fn(async () => ({
    choices: [{ finish_reason: "stop", message: { content: "hi there" } }],
    usage: { prompt_tokens: 3, completion_tokens: 4 },
  }));
  return new OpenAiModelProvider(
    { apiKey: "sk-test" },
    { chat: { completions: { create } } } as unknown as OpenAiChatCompletionsCommandClient,
    () => new Date(FIXED_CHECKED_AT),
  );
}

function equivalentMockProvider(): ModelProvider {
  return createMockModelProvider({
    capabilities: OPENAI_CAPABILITIES,
    health: {
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: { configured: true },
    },
    invoke: async () => ({
      outputJson: JSON.stringify({
        message: { role: "assistant", content: "hi there" },
        stop_reason: "stop",
      }),
      usageJson: JSON.stringify({ input_tokens: 3, output_tokens: 4 }),
      servedBy: "openai-secondary",
    }),
  });
}

describe("OpenAiModelProvider", () => {
  it("invokes chat completions and maps the response to the shared invocation contract", async () => {
    const create = vi.fn(async (params: { model: string; messages: unknown }) => {
      expect(params.model).toBe("gpt-5");
      expect(params.messages).toEqual([{ role: "user", content: "hello" }]);
      return {
        choices: [{ finish_reason: "stop", message: { content: "hi there" } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      };
    });
    const provider = new OpenAiModelProvider(
      { apiKey: "sk-test" },
      { chat: { completions: { create } } } as unknown as OpenAiChatCompletionsCommandClient,
    );

    const result = await provider.invoke(request());

    expect(JSON.parse(result.outputJson)).toEqual({
      message: { role: "assistant", content: "hi there" },
      stop_reason: "stop",
    });
    expect(JSON.parse(result.usageJson)).toEqual({
      input_tokens: 3,
      output_tokens: 4,
    });
    expect(result.servedBy).toBe("openai-secondary");
  });

  it("passes system messages through as-is and forwards inference params", async () => {
    const create = vi.fn(async (params: { messages: unknown; max_tokens?: number; temperature?: number }) => {
      expect(params.messages).toEqual([
        { role: "system", content: "be terse" },
        { role: "user", content: "hello" },
      ]);
      expect(params.max_tokens).toBe(256);
      expect(params.temperature).toBe(0.2);
      return {
        choices: [{ finish_reason: "stop", message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      };
    });
    const provider = new OpenAiModelProvider(
      { apiKey: "sk-test" },
      { chat: { completions: { create } } } as unknown as OpenAiChatCompletionsCommandClient,
    );

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

  it("throws when OpenAI returns no completion message content", async () => {
    const create = vi.fn(async () => ({
      choices: [{ finish_reason: "content_filter", message: { content: null } }],
    }));
    const provider = new OpenAiModelProvider(
      { apiKey: "sk-test" },
      { chat: { completions: { create } } } as unknown as OpenAiChatCompletionsCommandClient,
    );

    await expect(provider.invoke(request())).rejects.toThrow(
      /no completion message content/,
    );
  });

  it("defaults missing usage to zero", async () => {
    const create = vi.fn(async () => ({
      choices: [{ finish_reason: "stop", message: { content: "ok" } }],
    }));
    const provider = new OpenAiModelProvider(
      { apiKey: "sk-test" },
      { chat: { completions: { create } } } as unknown as OpenAiChatCompletionsCommandClient,
    );

    const result = await provider.invoke(request());
    expect(JSON.parse(result.usageJson)).toEqual({
      input_tokens: 0,
      output_tokens: 0,
    });
  });

  it("reports healthy without spending on a real completion call", async () => {
    const create = vi.fn();
    const provider = new OpenAiModelProvider(
      { apiKey: "sk-test" },
      { chat: { completions: { create } } } as unknown as OpenAiChatCompletionsCommandClient,
    );

    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "healthy",
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("ModelProvider contract", () => {
  it("passes the unmodified shared contract suite with the real OpenAI adapter", async () => {
    const report = await assertProviderContractParity(modelProviderContract, [
      { name: "openai-primary", create: realProvider },
      { name: "openai-parity", create: realProvider },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(4);
  });

  it("passes the unmodified shared contract suite across the real adapter and the mock", async () => {
    const report = await assertProviderContractParity(modelProviderContract, [
      { name: "openai-real", create: realProvider },
      { name: "openai-mock", create: equivalentMockProvider },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(4);
  });
});
