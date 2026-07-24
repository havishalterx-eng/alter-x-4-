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
    }): Promise<{
      readonly content: readonly { readonly type: string; readonly text?: string }[];
      readonly stop_reason: string | null;
      readonly usage: {
        readonly input_tokens: number;
        readonly output_tokens: number;
      };
    }>;
  };
}

const DEFAULT_MAX_TOKENS = 4_096;

export const ANTHROPIC_CAPABILITIES: ProviderCapabilities = {
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
    const payload = ModelInvocationPayloadSchema.parse(
      JSON.parse(request.inputJson),
    );

    const systemPrompt = payload.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const conversationMessages = payload.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      }));

    const response = await this.#client.messages.create({
      model: request.modelId,
      max_tokens: payload.max_tokens ?? DEFAULT_MAX_TOKENS,
      messages: conversationMessages,
      ...(systemPrompt.length === 0 ? {} : { system: systemPrompt }),
      ...(payload.temperature === undefined
        ? {}
        : { temperature: payload.temperature }),
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
