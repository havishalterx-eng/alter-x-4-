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
    };
  };
}

export const OPENAI_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
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
    const payload = ModelInvocationPayloadSchema.parse(
      JSON.parse(request.inputJson),
    );

    const response = await this.#client.chat.completions.create({
      model: request.modelId,
      messages: payload.messages,
      ...(payload.max_tokens === undefined
        ? {}
        : { max_tokens: payload.max_tokens }),
      ...(payload.temperature === undefined
        ? {}
        : { temperature: payload.temperature }),
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
