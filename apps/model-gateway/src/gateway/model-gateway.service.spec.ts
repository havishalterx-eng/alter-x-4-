import {
  createMockCacheProvider,
  createMockConfigProvider,
  createMockEmbeddingProvider,
  createMockModelProvider,
  createMockPIIRedactionProvider,
  createMockQueueProvider,
  type CacheProvider,
  type ConfigProvider,
  type EmbeddingProvider,
  type ModelProvider,
  type PIIRedactionProvider,
  type QueueProvider,
} from "@alterx/shared-clients";
import type { CostHandlerClient } from "@alterx/adapters";
import { describe, expect, it, vi, type Mock } from "vitest";

import { ModelGatewayService } from "./model-gateway.service";

const COST_EVENTS_QUEUE_NAME = "alter-dev-cost-events";

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
  readonly queueProvider?: QueueProvider;
  readonly costEventsQueueName?: string;
  readonly costClient?: CostHandlerClient;
}

function buildService(overrides: ServiceOverrides = {}): ModelGatewayService {
  return new ModelGatewayService(
    overrides.configProvider ?? createMockConfigProvider(),
    overrides.modelProvider ?? createMockModelProvider(),
    overrides.piiRedactionProvider ?? createMockPIIRedactionProvider(),
    overrides.embeddingProvider ?? createMockEmbeddingProvider(),
    overrides.cacheProvider ?? createMockCacheProvider(),
    overrides.queueProvider ?? createMockQueueProvider(),
    overrides.costEventsQueueName ?? COST_EVENTS_QUEUE_NAME,
    overrides.costClient ?? {
      ingestCostEvent: async () => ({ accepted: true }),
      resolveUnitPrice: async () => ({
        unit_cost_minor: "10", // Small value to not trip limit
        currency: "INR",
        confidence: "fixed_table",
      }),
      recordModelOutcome: async () => ({ accepted: true }),
    }
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

  it("embed() delegates to the EmbeddingProvider and returns its real vector", async () => {
    const embed = vi.fn(createMockEmbeddingProvider().embed);
    const embeddingProvider = createMockEmbeddingProvider({ embed });
    const service = buildService({ embeddingProvider });

    const response = await service.embed({
      tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
      text: "hello world",
      dimensions: 1024,
    });

    expect(embed).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        text: "hello world",
        dimensions: 1024,
      }),
    );
    expect(response.dimensions).toBe(1024);
    expect(response.embedding).toHaveLength(1024);
    expect(response.model_id).toBe("mock.embedding");
  });

  it("embed() never swallows a provider failure -- unlike the internal cache best-effort path", async () => {
    const embeddingProvider = createMockEmbeddingProvider({
      embed: async () => {
        throw new Error("bedrock throttled");
      },
    });
    const service = buildService({ embeddingProvider });

    await expect(
      service.embed({
        tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        text: "hello world",
        dimensions: 512,
      }),
    ).rejects.toThrow("bedrock throttled");
  });

  it("embed() rejects a dimensions value that is not 512 or 1024", async () => {
    const service = buildService();

    await expect(
      service.embed({
        tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        text: "hello world",
        dimensions: 768,
      }),
    ).rejects.toThrow(/512 or 1024/);
  });

  it("forwards model deltas incrementally instead of buffering the completion", async () => {
    let releaseSecond!: () => void;
    const secondAllowed = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const stream = vi.fn(async function* () {
      yield {
        sequence: 1,
        delta: "first",
        final: false as const,
        servedBy: "aws-bedrock",
      };
      await secondAllowed;
      yield {
        sequence: 2,
        delta: " second",
        final: false as const,
        servedBy: "aws-bedrock",
      };
      yield {
        sequence: 3,
        delta: "",
        final: true as const,
        usageJson: JSON.stringify({ input_tokens: 2, output_tokens: 2 }),
        servedBy: "aws-bedrock",
      };
    });
    const service = buildService({
      modelProvider: createMockModelProvider({ stream }),
    });
    const iterator = service.stream(request())[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { sequence: 1, delta: "first", final: false },
    });
    const second = iterator.next();
    let secondSettled = false;
    void second.finally(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    releaseSecond();
    await expect(second).resolves.toMatchObject({
      value: { sequence: 2, delta: " second", final: false },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { sequence: 3, delta: "", final: true },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("redacts PII before opening the provider stream", async () => {
    const stream = vi.fn(async function* () {
      yield {
        sequence: 1,
        delta: "",
        final: true as const,
        usageJson: JSON.stringify({ input_tokens: 1, output_tokens: 0 }),
        servedBy: "aws-bedrock",
      };
    });
    const service = buildService({
      modelProvider: createMockModelProvider({ stream }),
    });

    const iterator = service.stream(
      request({
        input_json: JSON.stringify({
          messages: [{ role: "user", content: "my PAN is ABCDE1234F" }],
        }),
      }),
    )[Symbol.asyncIterator]();
    while (!(await iterator.next()).done) {
      // Drain stream so final usage validation runs.
    }

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        inputJson: JSON.stringify({
          messages: [{ role: "user", content: "my PAN is <IN_PAN>" }],
        }),
      }),
    );
  });

  it("rejects a stream that ends without a terminal usage chunk", async () => {
    const service = buildService({
      modelProvider: createMockModelProvider({
        stream: async function* () {
          yield {
            sequence: 1,
            delta: "unfinished",
            final: false,
            servedBy: "aws-bedrock",
          };
        },
      }),
    });

    const drain = async () => {
      const iterator = service.stream(request())[Symbol.asyncIterator]();
      while (!(await iterator.next()).done) {
        // Drain malformed stream to force end-of-stream validation.
      }
    };
    await expect(drain()).rejects.toThrow(/without a final usage chunk/);
  });

  it("emits stream usage to the cost queue after the terminal chunk", async () => {
    const publish = vi.fn(async () => undefined);
    const service = buildService({
      queueProvider: createMockQueueProvider({ publish }),
      modelProvider: createMockModelProvider({
        stream: async function* () {
          yield {
            sequence: 1,
            delta: "done",
            final: false,
            servedBy: "mock.model",
          };
          yield {
            sequence: 2,
            delta: "",
            final: true,
            usageJson: JSON.stringify({ input_tokens: 4, output_tokens: 4 }),
            servedBy: "mock.model",
          };
        },
      }),
    });

    const chunks = [];
    for await (const chunk of service.stream(request())) {
      chunks.push(chunk);
    }

    expect(chunks.at(-1)).toMatchObject({ final: true });
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      COST_EVENTS_QUEUE_NAME,
      expect.objectContaining({
        tenant_id: request().tenant_id,
        usage_json: JSON.stringify({ input_tokens: 4, output_tokens: 4 }),
      }),
    );
  });

  it("fails a streamed completion closed when terminal usage exceeds its cost limit", async () => {
    const service = buildService({
      configProvider: createMockConfigProvider({
        costLimit: { maxTokensPerCall: 1, maxCostUsdPerCall: 1 },
      }),
      modelProvider: createMockModelProvider({
        stream: async function* () {
          yield {
            sequence: 1,
            delta: "done",
            final: false,
            servedBy: "mock.model",
          };
          yield {
            sequence: 2,
            delta: "",
            final: true,
            usageJson: JSON.stringify({ input_tokens: 2, output_tokens: 2 }),
            servedBy: "mock.model",
          };
        },
      }),
    });
    const drain = async () => {
      const iterator = service.stream(request())[Symbol.asyncIterator]();
      while (!(await iterator.next()).done) {
        // Drain until terminal usage is checked.
      }
    };

    await expect(drain()).rejects.toThrow(/tokens exceeds the resolved limit/);
  });

  it("emits a cost event to the configured queue on a successful invocation", async () => {
    const publish: Mock<(queueName: string, message: unknown) => Promise<void>> =
      vi.fn(async () => undefined);
    const queueProvider = createMockQueueProvider({ publish });
    const modelProvider = createMockModelProvider({
      invoke: async () => ({
        outputJson: JSON.stringify({
          message: { role: "assistant", content: "hi" },
          stop_reason: "end_turn",
        }),
        usageJson: JSON.stringify({ input_tokens: 100, output_tokens: 50 }),
        servedBy: "aws-bedrock",
      }),
    });
    const service = buildService({ modelProvider, queueProvider });

    await service.invoke(request());

    expect(publish).toHaveBeenCalledTimes(1);
    const call = publish.mock.calls[0];
    if (call === undefined) {
      throw new Error("publish was not called");
    }
    const [queueName, message] = call;
    const messageRecord = message as Record<string, string>;
    expect(queueName).toBe(COST_EVENTS_QUEUE_NAME);
    expect(messageRecord).toMatchObject({
      tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
      run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
      node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
      provider_reference: "aws-bedrock",
      usage_json: JSON.stringify({ input_tokens: 100, output_tokens: 50 }),
      source: "model_gateway",
    });
    expect(messageRecord.cost_event_id).toMatch(/^cst_/);
    expect(JSON.parse(messageRecord.amount_json ?? "")).toMatchObject({
      estimated: true,
    });
    expect(new Date(messageRecord.occurred_at ?? "").toString()).not.toBe("Invalid Date");
  });

  it("returns a successful response even when cost-event publish fails -- best-effort, never blocks", async () => {
    const queueProvider = createMockQueueProvider({
      publish: async () => {
        throw new Error("queue unreachable");
      },
    });
    const service = buildService({ queueProvider });

    await expect(service.invoke(request())).resolves.toMatchObject({
      resolved_capability: "STANDARD:mock.model",
    });
  });

  it("rejects an over-limit call with RESOURCE_EXHAUSTED-mapped error, after still emitting the cost event", async () => {
    const publish = vi.fn(async () => undefined);
    const queueProvider = createMockQueueProvider({ publish });
    const configProvider = createMockConfigProvider({
      costLimit: { maxTokensPerCall: 10, maxCostUsdPerCall: 5 },
    });
    const modelProvider = createMockModelProvider({
      invoke: async () => ({
        outputJson: JSON.stringify({
          message: { role: "assistant", content: "hi" },
          stop_reason: "end_turn",
        }),
        usageJson: JSON.stringify({ input_tokens: 5_000, output_tokens: 5_000 }),
        servedBy: "aws-bedrock",
      }),
    });
    const service = buildService({ configProvider, modelProvider, queueProvider });

    await expect(service.invoke(request())).rejects.toThrow(
      /exceeds the resolved limit/,
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("records a success outcome for the real serving provider on a successful invocation", async () => {
    const recordModelOutcome = vi.fn(async () => ({ accepted: true }));
    const modelProvider = createMockModelProvider({
      invoke: async () => ({
        outputJson: JSON.stringify({
          message: { role: "assistant", content: "hi" },
          stop_reason: "end_turn",
        }),
        usageJson: JSON.stringify({ input_tokens: 100, output_tokens: 50 }),
        servedBy: "aws-bedrock",
      }),
    });
    const service = buildService({
      modelProvider,
      costClient: {
        ingestCostEvent: async () => ({ accepted: true }),
        resolveUnitPrice: async () => ({
          unit_cost_minor: "10",
          currency: "INR",
          confidence: "fixed_table",
        }),
        recordModelOutcome,
      },
    });

    await service.invoke(request());

    expect(recordModelOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
        node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
        provider: "aws-bedrock",
        resource: "tokens",
        verdict: "success",
      }),
    );
  });

  it("records a failure outcome for the resolved model when the model provider itself throws", async () => {
    const recordModelOutcome = vi.fn(async () => ({ accepted: true }));
    const modelProvider = createMockModelProvider({
      invoke: async () => {
        throw new Error("bedrock unreachable");
      },
    });
    const service = buildService({
      modelProvider,
      costClient: {
        ingestCostEvent: async () => ({ accepted: true }),
        resolveUnitPrice: async () => ({
          unit_cost_minor: "10",
          currency: "INR",
          confidence: "fixed_table",
        }),
        recordModelOutcome,
      },
    });

    await expect(service.invoke(request())).rejects.toThrow("bedrock unreachable");

    expect(recordModelOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        provider: "mock.standard.v1",
        resource: "tokens",
        verdict: "failure",
      }),
    );
  });

  it("returns a successful response even when outcome recording fails -- best-effort, never blocks", async () => {
    const service = buildService({
      costClient: {
        ingestCostEvent: async () => ({ accepted: true }),
        resolveUnitPrice: async () => ({
          unit_cost_minor: "10",
          currency: "INR",
          confidence: "fixed_table",
        }),
        recordModelOutcome: async () => {
          throw new Error("cost ledger unreachable");
        },
      },
    });

    await expect(service.invoke(request())).resolves.toMatchObject({
      resolved_capability: "STANDARD:mock.model",
    });
  });

  it("records exactly one success outcome for a streamed completion, keyed by the terminal chunk's provider", async () => {
    const recordModelOutcome = vi.fn(async () => ({ accepted: true }));
    const service = buildService({
      modelProvider: createMockModelProvider({
        stream: async function* () {
          yield {
            sequence: 1,
            delta: "done",
            final: false,
            servedBy: "mock.model",
          };
          yield {
            sequence: 2,
            delta: "",
            final: true,
            usageJson: JSON.stringify({ input_tokens: 4, output_tokens: 4 }),
            servedBy: "mock.model",
          };
        },
      }),
      costClient: {
        ingestCostEvent: async () => ({ accepted: true }),
        resolveUnitPrice: async () => ({
          unit_cost_minor: "10",
          currency: "INR",
          confidence: "fixed_table",
        }),
        recordModelOutcome,
      },
    });

    for await (const _chunk of service.stream(request())) {
      // Drain to the terminal chunk.
    }

    expect(recordModelOutcome).toHaveBeenCalledTimes(1);
    expect(recordModelOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "mock.model", verdict: "success" }),
    );
  });

  it("records exactly one failure outcome, not a contradictory second one, when a streamed completion is closed for exceeding its cost limit", async () => {
    const recordModelOutcome = vi.fn(async () => ({ accepted: true }));
    const service = buildService({
      configProvider: createMockConfigProvider({
        costLimit: { maxTokensPerCall: 1, maxCostUsdPerCall: 1 },
      }),
      modelProvider: createMockModelProvider({
        stream: async function* () {
          yield {
            sequence: 1,
            delta: "done",
            final: false,
            servedBy: "mock.model",
          };
          yield {
            sequence: 2,
            delta: "",
            final: true,
            usageJson: JSON.stringify({ input_tokens: 2, output_tokens: 2 }),
            servedBy: "mock.model",
          };
        },
      }),
      costClient: {
        ingestCostEvent: async () => ({ accepted: true }),
        resolveUnitPrice: async () => ({
          unit_cost_minor: "10",
          currency: "INR",
          confidence: "fixed_table",
        }),
        recordModelOutcome,
      },
    });
    const drain = async () => {
      const iterator = service.stream(request())[Symbol.asyncIterator]();
      while (!(await iterator.next()).done) {
        // Drain until terminal usage is checked.
      }
    };

    await expect(drain()).rejects.toThrow(/tokens exceeds the resolved limit/);

    // The terminal chunk's real model call already succeeded -- only the
    // gateway's own post-hoc limit check rejected it, so exactly the one
    // "success" outcome recorded at the terminal chunk is correct, not a
    // second, contradictory "failure" for the same real call.
    expect(recordModelOutcome).toHaveBeenCalledTimes(1);
    expect(recordModelOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: "success" }),
    );
  });

  it("records a failure outcome when a stream ends without a terminal usage chunk", async () => {
    const recordModelOutcome = vi.fn(async () => ({ accepted: true }));
    const service = buildService({
      modelProvider: createMockModelProvider({
        stream: async function* () {
          yield {
            sequence: 1,
            delta: "unfinished",
            final: false,
            servedBy: "aws-bedrock",
          };
        },
      }),
      costClient: {
        ingestCostEvent: async () => ({ accepted: true }),
        resolveUnitPrice: async () => ({
          unit_cost_minor: "10",
          currency: "INR",
          confidence: "fixed_table",
        }),
        recordModelOutcome,
      },
    });

    const drain = async () => {
      const iterator = service.stream(request())[Symbol.asyncIterator]();
      while (!(await iterator.next()).done) {
        // Drain malformed stream to force end-of-stream validation.
      }
    };
    await expect(drain()).rejects.toThrow(/without a final usage chunk/);

    expect(recordModelOutcome).toHaveBeenCalledTimes(1);
    expect(recordModelOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "aws-bedrock", verdict: "failure" }),
    );
  });

  it("rejects a call whose estimated cost exceeds the resolved USD limit", async () => {
    const configProvider = createMockConfigProvider({
      costLimit: { maxTokensPerCall: 1_000_000, maxCostUsdPerCall: 0.0001 },
    });
    const modelProvider = createMockModelProvider({
      invoke: async () => ({
        outputJson: JSON.stringify({
          message: { role: "assistant", content: "hi" },
          stop_reason: "end_turn",
        }),
        usageJson: JSON.stringify({ input_tokens: 1_000, output_tokens: 1_000 }),
        servedBy: "aws-bedrock",
      }),
    });
    const service = buildService({ configProvider, modelProvider });

    await expect(service.invoke(request())).rejects.toThrow(
      /exceeds the resolved limit/,
    );
  });

  it("rejects a response whose output_json is not a JSON object", async () => {
    const modelProvider = createMockModelProvider({
      invoke: async () => ({
        outputJson: JSON.stringify("just a string"),
        usageJson: JSON.stringify({ input_tokens: 1, output_tokens: 1 }),
        servedBy: "aws-bedrock",
      }),
    });
    const service = buildService({ modelProvider });

    await expect(service.invoke(request())).rejects.toThrow(
      /output_json must decode to a JSON object/,
    );
  });

  it("rejects a response whose usage_json does not conform to the shared usage contract", async () => {
    const modelProvider = createMockModelProvider({
      invoke: async () => ({
        outputJson: JSON.stringify({
          message: { role: "assistant", content: "hi" },
          stop_reason: "end_turn",
        }),
        usageJson: JSON.stringify({ totally: "wrong shape" }),
        servedBy: "aws-bedrock",
      }),
    });
    const service = buildService({ modelProvider });

    await expect(service.invoke(request())).rejects.toThrow(
      /usage_json does not conform/,
    );
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
    expect(first.cache_hit).toBe(false);
    expect(second.cache_hit).toBe(true);
    expect(second).toEqual({ ...first, cache_hit: true });
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
