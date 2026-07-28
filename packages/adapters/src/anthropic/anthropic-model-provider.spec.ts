import {
  assertProviderContractParity,
  createMockModelProvider,
  modelProviderContract,
  type ModelProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  ANTHROPIC_CAPABILITIES,
  AnthropicModelProvider,
  type AnthropicMessagesCommandClient,
} from "./anthropic-model-provider";

const FIXED_CHECKED_AT = "2026-07-24T00:00:00.000Z";

function request(overrides: Partial<Parameters<AnthropicModelProvider["invoke"]>[0]> = {}) {
  return {
    tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
    runId: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
    nodeExecutionId: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
    modelId: "claude-sonnet-5",
    capabilityTags: ["general"],
    inputJson: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    ...overrides,
  };
}

function realProvider(): ModelProvider {
  const create = vi.fn(async (params: { stream?: boolean }) => {
    if (params.stream) {
      return (async function* () {
        yield {
          type: "message_start" as const,
          message: { usage: { input_tokens: 3, output_tokens: 0 } },
        };
        yield {
          type: "content_block_delta" as const,
          delta: { type: "text_delta", text: "hi " },
        };
        yield {
          type: "content_block_delta" as const,
          delta: { type: "text_delta", text: "there" },
        };
        yield {
          type: "message_delta" as const,
          usage: { output_tokens: 4 },
        };
        yield { type: "message_stop" as const };
      })();
    }
    return {
      content: [{ type: "text", text: "hi there" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 4 },
    };
  });
  return new AnthropicModelProvider(
    { apiKey: "sk-test" },
    { messages: { create } } as unknown as AnthropicMessagesCommandClient,
    () => new Date(FIXED_CHECKED_AT),
  );
}

function equivalentMockProvider(): ModelProvider {
  return createMockModelProvider({
    capabilities: ANTHROPIC_CAPABILITIES,
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
      servedBy: "anthropic-direct",
    }),
    stream: async function* () {
      yield { sequence: 1, delta: "hi ", final: false, servedBy: "anthropic-direct" };
      yield { sequence: 2, delta: "there", final: false, servedBy: "anthropic-direct" };
      yield {
        sequence: 3,
        delta: "",
        final: true,
        usageJson: JSON.stringify({ input_tokens: 3, output_tokens: 4 }),
        servedBy: "anthropic-direct",
      };
    },
  });
}

describe("AnthropicModelProvider", () => {
  it("invokes Messages and maps the response to the shared invocation contract", async () => {
    const create = vi.fn(async (params: { model: string; messages: unknown }) => {
      expect(params.model).toBe("claude-sonnet-5");
      expect(params.messages).toEqual([{ role: "user", content: "hello" }]);
      return {
        content: [{ type: "text", text: "hi there" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 3, output_tokens: 4 },
      };
    });
    const provider = new AnthropicModelProvider(
      { apiKey: "sk-test" },
      { messages: { create } } as unknown as AnthropicMessagesCommandClient,
    );

    const result = await provider.invoke(request());

    expect(JSON.parse(result.outputJson)).toEqual({
      message: { role: "assistant", content: "hi there" },
      stop_reason: "end_turn",
    });
    expect(JSON.parse(result.usageJson)).toEqual({
      input_tokens: 3,
      output_tokens: 4,
    });
    expect(result.servedBy).toBe("anthropic-direct");
  });

  it("joins system messages into the top-level system prompt", async () => {
    const create = vi.fn(async (params: { system?: string; messages: unknown }) => {
      expect(params.system).toBe("be terse");
      expect(params.messages).toEqual([{ role: "user", content: "hello" }]);
      return {
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const provider = new AnthropicModelProvider(
      { apiKey: "sk-test" },
      { messages: { create } } as unknown as AnthropicMessagesCommandClient,
    );

    await provider.invoke(
      request({
        inputJson: JSON.stringify({
          messages: [
            { role: "system", content: "be terse" },
            { role: "user", content: "hello" },
          ],
        }),
      }),
    );
  });

  it("forwards temperature to Anthropic when present", async () => {
    const create = vi.fn(async (params: { temperature?: number }) => {
      expect(params.temperature).toBe(0.2);
      return {
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const provider = new AnthropicModelProvider(
      { apiKey: "sk-test" },
      { messages: { create } } as unknown as AnthropicMessagesCommandClient,
    );

    await provider.invoke(
      request({
        inputJson: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
          temperature: 0.2,
        }),
      }),
    );
  });

  it("omits temperature when absent instead of sending undefined", async () => {
    const create = vi.fn(async (params: { temperature?: number }) => {
      expect(params).not.toHaveProperty("temperature");
      return {
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const provider = new AnthropicModelProvider(
      { apiKey: "sk-test" },
      { messages: { create } } as unknown as AnthropicMessagesCommandClient,
    );

    await provider.invoke(request());
  });

  it("throws when Anthropic returns no text content block", async () => {
    const create = vi.fn(async () => ({
      content: [{ type: "tool_use" }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const provider = new AnthropicModelProvider(
      { apiKey: "sk-test" },
      { messages: { create } } as unknown as AnthropicMessagesCommandClient,
    );

    await expect(provider.invoke(request())).rejects.toThrow(
      /no text content block/,
    );
  });

  it("reports healthy without spending on a real message call", async () => {
    const create = vi.fn();
    const provider = new AnthropicModelProvider(
      { apiKey: "sk-test" },
      { messages: { create } } as unknown as AnthropicMessagesCommandClient,
    );

    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "healthy",
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("ModelProvider contract", () => {
  it("passes the unmodified shared contract suite with the real Anthropic adapter", async () => {
    const report = await assertProviderContractParity(modelProviderContract, [
      { name: "anthropic-primary", create: realProvider },
      { name: "anthropic-parity", create: realProvider },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });

  it("passes the unmodified shared contract suite across the real adapter and the mock", async () => {
    const report = await assertProviderContractParity(modelProviderContract, [
      { name: "anthropic-real", create: realProvider },
      { name: "anthropic-mock", create: equivalentMockProvider },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });
});
