import {
  createMockCacheProvider,
  createMockConfigProvider,
  createMockEmbeddingProvider,
  createMockModelProvider,
  createMockPIIRedactionProvider,
  type CacheProvider,
  type ConfigProvider,
  type EmbeddingProvider,
  type ModelProvider,
  type PIIRedactionProvider,
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

interface ServiceOverrides {
  readonly configProvider?: ConfigProvider;
  readonly modelProvider?: ModelProvider;
  readonly piiRedactionProvider?: PIIRedactionProvider;
  readonly embeddingProvider?: EmbeddingProvider;
  readonly cacheProvider?: CacheProvider;
}

function buildService(overrides: ServiceOverrides = {}): ModelGatewayService {
  return new ModelGatewayService(
    overrides.configProvider ?? createMockConfigProvider(),
    overrides.modelProvider ?? createMockModelProvider(),
    overrides.piiRedactionProvider ?? createMockPIIRedactionProvider(),
    overrides.embeddingProvider ?? createMockEmbeddingProvider(),
    overrides.cacheProvider ?? createMockCacheProvider(),
  );
}

describe("ModelGatewayService", () => {
  it("resolves the alias via config only and delegates the call to the model provider", async () => {
    const configProvider = createMockConfigProvider();
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const service = buildService({ configProvider, modelProvider });

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
    expect(response.resolved_capability).toBe("STANDARD:mock.model");
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
    const service = buildService({ configProvider, modelProvider });

    await service.invoke(request({ model_alias: "CEILING" }));

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "mock.ceiling.v1" }),
    );
  });

  it("threads the alias binding's fallback_chain through to the model provider", async () => {
    const configProvider = createMockConfigProvider({
      policy: {
        version: "test.1",
        bindings: {
          FAST: { model_id: "mock.fast.v1", capability_tags: [] },
          STANDARD: {
            model_id: "mock.standard.v1",
            capability_tags: ["general"],
            fallback_chain: [
              { provider: "anthropic", model_id: "claude-sonnet-5" },
              { provider: "openai", model_id: "gpt-5" },
            ],
          },
          ADVANCED: { model_id: "mock.advanced.v1", capability_tags: [] },
          CEILING: { model_id: "mock.ceiling.v1", capability_tags: [] },
        },
      },
    });
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const service = buildService({ configProvider, modelProvider });

    await service.invoke(request());

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackChain: [
          { provider: "anthropic", model_id: "claude-sonnet-5" },
          { provider: "openai", model_id: "gpt-5" },
        ],
      }),
    );
  });

  it("reflects the provider that actually served the call, not just the requested alias -- no silent downgrade", async () => {
    const configProvider = createMockConfigProvider();
    const modelProvider = createMockModelProvider({
      invoke: async () => ({
        outputJson: JSON.stringify({
          message: { role: "assistant", content: "fallback response" },
          stop_reason: "end_turn",
        }),
        usageJson: JSON.stringify({ input_tokens: 1, output_tokens: 1 }),
        servedBy: "anthropic-direct",
      }),
    });
    const service = buildService({ configProvider, modelProvider });

    const response = await service.invoke(request());

    expect(response.resolved_capability).toBe("STANDARD:anthropic-direct");
  });

  it("rejects a model_alias that is not one of the four tiers", async () => {
    const service = buildService();

    await expect(
      service.invoke(request({ model_alias: "ULTRA" })),
    ).rejects.toThrow(/not a recognized alias tier/);
  });

  it("redacts PII out of input_json before it reaches the model provider -- GATE-1's outbound path", async () => {
    const configProvider = createMockConfigProvider();
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const piiRedactionProvider = createMockPIIRedactionProvider();
    const service = buildService({
      configProvider,
      modelProvider,
      piiRedactionProvider,
    });

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
    const service = buildService();

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
    const service = buildService();

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

  it("misses the cache on the first call, invokes the real model, then stores the result", async () => {
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const embed = vi.fn(createMockEmbeddingProvider().embed);
    const embeddingProvider = createMockEmbeddingProvider({ embed });
    const cacheProvider = createMockCacheProvider();
    const service = buildService({
      modelProvider,
      embeddingProvider,
      cacheProvider,
    });

    await service.invoke(request());

    expect(invoke).toHaveBeenCalledTimes(1);
    // Embedding is computed once and reused for both the lookup and the
    // store -- calling the real embedding provider twice per cache miss
    // would double its cost for no benefit.
    expect(embed).toHaveBeenCalledTimes(1);
    const stored = (
      cacheProvider as ReturnType<typeof createMockCacheProvider>
    ).getStoredEntries();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tenantId).toBe(
      "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
    );
    const cachedValue = JSON.parse(stored[0]?.valueJson ?? "{}");
    expect(cachedValue).toHaveProperty("output_json");
    expect(cachedValue).toHaveProperty("resolved_capability");
  });

  it("hits the cache on a semantically identical second call and never invokes the real model again", async () => {
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    // Deterministic embedding: identical redacted text -> identical vector,
    // so the second call is guaranteed to be an exact cache hit.
    const embeddingProvider = createMockEmbeddingProvider();
    const cacheProvider = createMockCacheProvider();
    const service = buildService({
      modelProvider,
      embeddingProvider,
      cacheProvider,
    });

    const first = await service.invoke(request());
    const second = await service.invoke(request());

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("does not cache-hit across different tenants even with identical input", async () => {
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const cacheProvider = createMockCacheProvider();
    const service = buildService({ modelProvider, cacheProvider });

    await service.invoke(request({ tenant_id: "ten_tenant_a" }));
    await service.invoke(request({ tenant_id: "ten_tenant_b" }));

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("falls through to a real model call when the embedding provider fails (best-effort cache)", async () => {
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const embeddingProvider: EmbeddingProvider = {
      ...createMockEmbeddingProvider(),
      embed: async () => {
        throw new Error("embedding provider unavailable");
      },
    };
    const service = buildService({ modelProvider, embeddingProvider });

    const response = await service.invoke(request());

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(response.resolved_capability).toBe("STANDARD:mock.model");
  });

  it("still returns a successful response when the cache store fails after a real invocation", async () => {
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const cacheProvider: CacheProvider = {
      ...createMockCacheProvider(),
      storeSemantic: async () => {
        throw new Error("cache unavailable");
      },
    };
    const service = buildService({ modelProvider, cacheProvider });

    const response = await service.invoke(request());

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(response.resolved_capability).toBe("STANDARD:mock.model");
  });

  it("ignores a corrupt cached value and falls through to a real model call", async () => {
    const invoke = vi.fn(createMockModelProvider().invoke);
    const modelProvider = createMockModelProvider({ invoke });
    const cacheProvider: CacheProvider = {
      ...createMockCacheProvider(),
      lookupSemantic: async () => ({ hit: true, valueJson: "not-json{{{" }),
    };
    const service = buildService({ modelProvider, cacheProvider });

    const response = await service.invoke(request());

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(response.resolved_capability).toBe("STANDARD:mock.model");
  });
});
