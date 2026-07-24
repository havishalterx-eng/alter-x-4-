import { createMockModelProvider } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import { FailoverModelProvider } from "./failover-model-provider";

function request(overrides: Partial<Parameters<FailoverModelProvider["invoke"]>[0]> = {}) {
  return {
    tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
    runId: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
    nodeExecutionId: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
    modelId: "bedrock-primary-model",
    capabilityTags: ["general"],
    inputJson: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    fallbackChain: [
      { provider: "anthropic" as const, model_id: "claude-sonnet-5" },
      { provider: "openai" as const, model_id: "gpt-5" },
    ],
    ...overrides,
  };
}

describe("FailoverModelProvider", () => {
  it("uses the primary provider when it succeeds, never touching fallbacks", async () => {
    const primaryInvoke = vi.fn(async () => ({
      outputJson: "primary-output",
      usageJson: "primary-usage",
      servedBy: "aws-bedrock",
    }));
    const anthropicInvoke = vi.fn();
    const primary = createMockModelProvider({ invoke: primaryInvoke });
    const anthropic = createMockModelProvider({ invoke: anthropicInvoke });
    const provider = new FailoverModelProvider(primary, { anthropic });

    const result = await provider.invoke(request());

    expect(result.servedBy).toBe("aws-bedrock");
    expect(anthropicInvoke).not.toHaveBeenCalled();
  });

  it("fails over to the first configured fallback when the primary throws", async () => {
    const primaryInvoke = vi.fn(async () => {
      throw new Error("bedrock unavailable");
    });
    const anthropicInvoke = vi.fn(async (req: { modelId: string }) => {
      expect(req.modelId).toBe("claude-sonnet-5");
      return {
        outputJson: "anthropic-output",
        usageJson: "anthropic-usage",
        servedBy: "anthropic-direct",
      };
    });
    const openaiInvoke = vi.fn();
    const primary = createMockModelProvider({ invoke: primaryInvoke });
    const anthropic = createMockModelProvider({ invoke: anthropicInvoke });
    const openai = createMockModelProvider({ invoke: openaiInvoke });
    const provider = new FailoverModelProvider(primary, { anthropic, openai });

    const result = await provider.invoke(request());

    expect(result.servedBy).toBe("anthropic-direct");
    expect(openaiInvoke).not.toHaveBeenCalled();
  });

  it("falls through to the second fallback when the first also fails", async () => {
    const primary = createMockModelProvider({
      invoke: vi.fn(async () => {
        throw new Error("bedrock down");
      }),
    });
    const anthropic = createMockModelProvider({
      invoke: vi.fn(async () => {
        throw new Error("anthropic down");
      }),
    });
    const openai = createMockModelProvider({
      invoke: vi.fn(async (req: { modelId: string }) => {
        expect(req.modelId).toBe("gpt-5");
        return {
          outputJson: "openai-output",
          usageJson: "openai-usage",
          servedBy: "openai-secondary",
        };
      }),
    });
    const provider = new FailoverModelProvider(primary, { anthropic, openai });

    const result = await provider.invoke(request());

    expect(result.servedBy).toBe("openai-secondary");
  });

  it("throws the last error when every provider in the chain fails", async () => {
    const primary = createMockModelProvider({
      invoke: vi.fn(async () => {
        throw new Error("bedrock down");
      }),
    });
    const anthropic = createMockModelProvider({
      invoke: vi.fn(async () => {
        throw new Error("anthropic down");
      }),
    });
    const openai = createMockModelProvider({
      invoke: vi.fn(async () => {
        throw new Error("openai down, final");
      }),
    });
    const provider = new FailoverModelProvider(primary, { anthropic, openai });

    await expect(provider.invoke(request())).rejects.toThrow(
      "openai down, final",
    );
  });

  it("propagates the primary error unchanged when no fallback chain is configured", async () => {
    const primary = createMockModelProvider({
      invoke: vi.fn(async () => {
        throw new Error("bedrock down, no fallback");
      }),
    });
    const provider = new FailoverModelProvider(primary, {});
    const requestWithoutFallback = {
      tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
      runId: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
      nodeExecutionId: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
      modelId: "bedrock-primary-model",
      capabilityTags: ["general"],
      inputJson: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    };

    await expect(
      provider.invoke(requestWithoutFallback),
    ).rejects.toThrow("bedrock down, no fallback");
  });

  it("skips a fallback tier that has no provider configured", async () => {
    const primary = createMockModelProvider({
      invoke: vi.fn(async () => {
        throw new Error("bedrock down");
      }),
    });
    const openai = createMockModelProvider({
      invoke: vi.fn(async () => ({
        outputJson: "openai-output",
        usageJson: "openai-usage",
        servedBy: "openai-secondary",
      })),
    });
    // Only openai configured; the fallback_chain's anthropic entry has no
    // matching provider and must be skipped, not treated as a failure.
    const provider = new FailoverModelProvider(primary, { openai });

    const result = await provider.invoke(request());

    expect(result.servedBy).toBe("openai-secondary");
  });

  it("delegates capabilities and health to the primary provider", async () => {
    const primary = createMockModelProvider();
    const provider = new FailoverModelProvider(primary, {});

    expect(provider.capabilities).toEqual(primary.capabilities);
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "healthy",
    });
  });
});
