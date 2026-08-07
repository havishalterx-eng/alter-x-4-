import {
  createMockModelProvider,
  createMockMutableParameterStoreProvider,
  type ModelProvider,
} from "@alterx/shared-clients";
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

  it("fails over a stream only when the primary fails before emitting", async () => {
    const primaryStream = vi.fn(async function* () {
      throw new Error("bedrock stream unavailable");
    });
    const fallbackStream = vi.fn(async function* (req: { modelId: string }) {
      expect(req.modelId).toBe("claude-sonnet-5");
      yield {
        sequence: 1,
        delta: "fallback",
        final: false as const,
        servedBy: "anthropic-direct",
      };
      yield {
        sequence: 2,
        delta: "",
        final: true as const,
        usageJson: JSON.stringify({ input_tokens: 1, output_tokens: 1 }),
        servedBy: "anthropic-direct",
      };
    });
    const provider = new FailoverModelProvider(
      createMockModelProvider({ stream: primaryStream }),
      {
        anthropic: createMockModelProvider({ stream: fallbackStream }),
      },
    );

    const chunks = [];
    for await (const chunk of provider.stream(request())) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.delta)).toEqual(["fallback", ""]);
    expect(fallbackStream).toHaveBeenCalledTimes(1);
  });

  it("never splices a fallback completion after primary bytes were emitted", async () => {
    const primaryStream = vi.fn(async function* () {
      yield {
        sequence: 1,
        delta: "partial primary",
        final: false as const,
        servedBy: "aws-bedrock",
      };
      throw new Error("primary stream broke after emission");
    });
    const fallbackStream = vi.fn(async function* () {
      yield {
        sequence: 1,
        delta: "unrelated fallback",
        final: false as const,
        servedBy: "anthropic-direct",
      };
    });
    const provider = new FailoverModelProvider(
      createMockModelProvider({ stream: primaryStream }),
      {
        anthropic: createMockModelProvider({ stream: fallbackStream }),
      },
    );
    const iterator = provider.stream(request())[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { delta: "partial primary" },
    });
    await expect(iterator.next()).rejects.toThrow(
      "primary stream broke after emission",
    );
    expect(fallbackStream).not.toHaveBeenCalled();
  });

  it("persists provider activation and applies it to real invocation routing", async () => {
    const store = createMockMutableParameterStoreProvider();
    const primaryInvoke = vi.fn(async () => ({
      outputJson: "primary",
      usageJson: "{}",
      servedBy: "aws-bedrock",
    }));
    const fallbackInvoke = vi.fn(async () => ({
      outputJson: "fallback",
      usageJson: "{}",
      servedBy: "anthropic-direct",
    }));
    const options = { store, parameterName: "/controls" };
    const provider = new FailoverModelProvider(
      createMockModelProvider({ providerId: "aws-bedrock", invoke: primaryInvoke }),
      {
        anthropic: createMockModelProvider({
          providerId: "anthropic-direct",
          invoke: fallbackInvoke,
        }),
      },
      options,
    );

    await provider.updateProviderControl("aws-bedrock", { active: false });
    await expect(provider.invoke(request())).resolves.toMatchObject({
      servedBy: "anthropic-direct",
    });
    expect(primaryInvoke).not.toHaveBeenCalled();

    const reloaded = new FailoverModelProvider(
      createMockModelProvider({ providerId: "aws-bedrock", invoke: primaryInvoke }),
      {
        anthropic: createMockModelProvider({
          providerId: "anthropic-direct",
          invoke: fallbackInvoke,
        }),
      },
      options,
    );
    await reloaded.hydrateControls();
    await reloaded.invoke(request());
    expect(primaryInvoke).not.toHaveBeenCalled();
    expect(fallbackInvoke).toHaveBeenCalledTimes(2);
  });

  it("persists fallback order and probes every provider live", async () => {
    const store = createMockMutableParameterStoreProvider();
    const primaryBase = createMockModelProvider({
      providerId: "aws-bedrock",
      invoke: vi.fn(async () => { throw new Error("down"); }),
    });
    const anthropicBase = createMockModelProvider({
      providerId: "anthropic-direct",
      invoke: vi.fn(async () => ({ outputJson: "a", usageJson: "{}", servedBy: "anthropic-direct" })),
    });
    const openaiBase = createMockModelProvider({
      providerId: "openai-direct",
      invoke: vi.fn(async () => ({ outputJson: "o", usageJson: "{}", servedBy: "openai-direct" })),
    });
    const primaryHealth = vi.fn(() => primaryBase.healthCheck());
    const anthropicHealth = vi.fn(() => anthropicBase.healthCheck());
    const openaiHealth = vi.fn(() => openaiBase.healthCheck());
    const primary = withHealth(primaryBase, primaryHealth);
    const anthropic = withHealth(anthropicBase, anthropicHealth);
    const openai = withHealth(openaiBase, openaiHealth);
    const provider = new FailoverModelProvider(
      primary,
      { anthropic, openai },
      { store, parameterName: "/controls" },
    );

    await provider.updateProviderControl("aws-bedrock", {
      fallbackChain: ["openai-direct", "anthropic-direct"],
    });
    await expect(provider.invoke(request())).resolves.toMatchObject({
      servedBy: "openai-direct",
    });
    await provider.getProviderControls();
    await provider.getProviderControls();
    expect(primaryHealth).toHaveBeenCalledTimes(3);
    expect(anthropicHealth).toHaveBeenCalledTimes(3);
    expect(openaiHealth).toHaveBeenCalledTimes(3);
  });
});

function withHealth(
  provider: ModelProvider,
  healthCheck: ModelProvider["healthCheck"],
): ModelProvider {
  return { ...provider, healthCheck };
}
