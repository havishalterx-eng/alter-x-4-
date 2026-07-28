import Anthropic from "@anthropic-ai/sdk";

import {
  ModelInvocationPayloadSchema,
  type ModelInvocationResultPayload,
  type ModelInvocationUsage,
  type ProviderCapabilities,
} from "@alterx/contracts";
import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelInvocationStreamChunk,
  ModelProvider,
  ProviderHealth,
  ProviderMetadata,
} from "@alterx/shared-clients";

export interface AnthropicModelProviderConfig {
  readonly apiKey: string;
}

export interface AnthropicMessagesCommandClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      temperature?: number;
      messages: readonly { role: "user" | "assistant"; content: string }[];
      system?: string;
      stream?: false;
    }): Promise<{
      readonly content: readonly { readonly type: string; readonly text?: string }[];
      readonly stop_reason: string | null;
      readonly usage: {
        readonly input_tokens: number;
        readonly output_tokens: number;
      };
    }>;
    create(params: {
      model: string;
      max_tokens: number;
      temperature?: number;
      messages: readonly { role: "user" | "assistant"; content: string }[];
      system?: string;
      stream: true;
    }): Promise<AsyncIterable<AnthropicStreamEvent>>;
  };
}

export type AnthropicStreamEvent =
  | {
      readonly type: "message_start";
      readonly message: {
        readonly usage: {
          readonly input_tokens: number;
          readonly output_tokens: number;
        };
      };
    }
  | {
      readonly type: "content_block_delta";
      readonly delta: { readonly type: string; readonly text?: string };
    }
  | {
      readonly type: "message_delta";
      readonly usage: { readonly output_tokens: number };
    }
  | { readonly type: "message_stop" };

const DEFAULT_MAX_TOKENS = 4_096;

export const ANTHROPIC_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: true,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 5_000_000,
  supported_languages: [],
  cost_model: { rates: [] },
};

const ANTHROPIC_METADATA: ProviderMetadata<"ModelProvider"> = {
  providerId: "anthropic-direct",
  interfaceName: "ModelProvider",
  displayName: "Anthropic direct API",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.anthropic.direct",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "anthropic-direct-v1",
    rollbackSupported: true,
  },
};

export class AnthropicModelProvider implements ModelProvider {
  readonly metadata = ANTHROPIC_METADATA;
  readonly capabilities = ANTHROPIC_CAPABILITIES;

  readonly #client: AnthropicMessagesCommandClient;
  readonly #now: () => Date;

  constructor(
    config: AnthropicModelProviderConfig,
    client?: AnthropicMessagesCommandClient,
    now?: () => Date,
  ) {
    this.#client =
      client ??
      (new Anthropic({
        apiKey: config.apiKey,
      }) as unknown as AnthropicMessagesCommandClient);
    this.#now = now ?? (() => new Date());
  }

  async invoke(
    request: ModelInvocationRequest,
  ): Promise<ModelInvocationResult> {
    const response = await this.#client.messages.create({
      ...anthropicInput(request),
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (textBlock?.text === undefined) {
      throw new Error(
        "Anthropic response contained no text content block",
      );
    }

    const result: ModelInvocationResultPayload = {
      message: { role: "assistant", content: textBlock.text },
      stop_reason: response.stop_reason ?? "unknown",
    };
    const usage: ModelInvocationUsage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };

    return {
      outputJson: JSON.stringify(result),
      usageJson: JSON.stringify(usage),
      servedBy: this.metadata.providerId,
    };
  }

  async *stream(
    request: ModelInvocationRequest,
  ): AsyncIterable<ModelInvocationStreamChunk> {
    const events = await this.#client.messages.create({
      ...anthropicInput(request),
      stream: true,
    });
    let sequence = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const event of events) {
      if (event.type === "message_start") {
        inputTokens = event.message.usage.input_tokens;
        outputTokens = event.message.usage.output_tokens;
      } else if (event.type === "message_delta") {
        outputTokens = event.usage.output_tokens;
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        event.delta.text !== undefined &&
        event.delta.text.length > 0
      ) {
        sequence += 1;
        yield {
          sequence,
          delta: event.delta.text,
          final: false,
          servedBy: this.metadata.providerId,
        };
      }
    }
    if (sequence === 0) {
      throw new Error("Anthropic stream returned no text deltas");
    }
    yield {
      sequence: sequence + 1,
      delta: "",
      final: true,
      usageJson: JSON.stringify({
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      }),
      servedBy: this.metadata.providerId,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    // Same rationale as AwsBedrockModelProvider: a real Messages call
    // spends tokens on every poll, so report healthy once constructed.
    return {
      status: "healthy",
      checkedAt: this.#now().toISOString(),
      latencyMs: 0,
      details: { configured: true },
    };
  }
}

function anthropicInput(request: ModelInvocationRequest) {
  const payload = ModelInvocationPayloadSchema.parse(
    JSON.parse(request.inputJson),
  );
  const system = payload.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return {
    model: request.modelId,
    max_tokens: payload.max_tokens ?? DEFAULT_MAX_TOKENS,
    messages: payload.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      })),
    ...(system.length === 0 ? {} : { system }),
    ...(payload.temperature === undefined
      ? {}
      : { temperature: payload.temperature }),
  };
}
