import OpenAI from "openai";

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

export interface OpenAiModelProviderConfig {
  readonly apiKey: string;
}

export interface OpenAiChatCompletionsCommandClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        max_tokens?: number;
        temperature?: number;
        messages: readonly {
          role: "system" | "user" | "assistant";
          content: string;
        }[];
        stream?: false;
      }): Promise<{
        readonly choices: readonly {
          readonly finish_reason: string;
          readonly message: { readonly content: string | null };
        }[];
        readonly usage?: {
          readonly prompt_tokens: number;
          readonly completion_tokens: number;
        };
      }>;
      create(params: {
        model: string;
        max_tokens?: number;
        temperature?: number;
        messages: readonly {
          role: "system" | "user" | "assistant";
          content: string;
        }[];
        stream: true;
        stream_options: { readonly include_usage: true };
      }): Promise<AsyncIterable<OpenAiStreamChunk>>;
    };
  };
}

export interface OpenAiStreamChunk {
  readonly choices: readonly {
    readonly delta: { readonly content?: string | null };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
  } | null;
}

export const OPENAI_CAPABILITIES: ProviderCapabilities = {
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

const OPENAI_METADATA: ProviderMetadata<"ModelProvider"> = {
  providerId: "openai-secondary",
  interfaceName: "ModelProvider",
  displayName: "OpenAI secondary",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.openai",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "openai-secondary-v1",
    rollbackSupported: true,
  },
};

export class OpenAiModelProvider implements ModelProvider {
  readonly metadata = OPENAI_METADATA;
  readonly capabilities = OPENAI_CAPABILITIES;

  readonly #client: OpenAiChatCompletionsCommandClient;
  readonly #now: () => Date;

  constructor(
    config: OpenAiModelProviderConfig,
    client?: OpenAiChatCompletionsCommandClient,
    now?: () => Date,
  ) {
    this.#client =
      client ??
      (new OpenAI({
        apiKey: config.apiKey,
      }) as unknown as OpenAiChatCompletionsCommandClient);
    this.#now = now ?? (() => new Date());
  }

  async invoke(
    request: ModelInvocationRequest,
  ): Promise<ModelInvocationResult> {
    const response = await this.#client.chat.completions.create({
      ...openAiInput(request),
    });

    const choice = response.choices[0];
    if (choice?.message.content === null || choice?.message.content === undefined) {
      throw new Error(
        "OpenAI response contained no completion message content",
      );
    }

    const result: ModelInvocationResultPayload = {
      message: { role: "assistant", content: choice.message.content },
      stop_reason: choice.finish_reason,
    };
    const usage: ModelInvocationUsage = {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
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
    const stream = await this.#client.chat.completions.create({
      ...openAiInput(request),
      stream: true,
      stream_options: { include_usage: true },
    });
    let sequence = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta.content;
      if (delta !== undefined && delta !== null && delta.length > 0) {
        sequence += 1;
        yield {
          sequence,
          delta,
          final: false,
          servedBy: this.metadata.providerId,
        };
      }
      inputTokens = chunk.usage?.prompt_tokens ?? inputTokens;
      outputTokens = chunk.usage?.completion_tokens ?? outputTokens;
    }
    if (sequence === 0) {
      throw new Error("OpenAI stream returned no text deltas");
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
    // Same rationale as the other model-invocation adapters: a real
    // completion call spends tokens on every poll.
    return {
      status: "healthy",
      checkedAt: this.#now().toISOString(),
      latencyMs: 0,
      details: { configured: true },
    };
  }
}

function openAiInput(request: ModelInvocationRequest) {
  const payload = ModelInvocationPayloadSchema.parse(
    JSON.parse(request.inputJson),
  );
  return {
    model: request.modelId,
    messages: payload.messages,
    ...(payload.max_tokens === undefined
      ? {}
      : { max_tokens: payload.max_tokens }),
    ...(payload.temperature === undefined
      ? {}
      : { temperature: payload.temperature }),
  };
}
