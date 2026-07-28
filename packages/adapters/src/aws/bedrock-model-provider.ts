import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ConverseCommandOutput,
  type ConverseStreamCommandOutput,
  type ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";

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

export interface AwsBedrockModelProviderConfig {
  readonly region: string;
}

export interface BedrockRuntimeCommandClient {
  send(command: ConverseCommand): Promise<ConverseCommandOutput>;
  send(command: ConverseStreamCommand): Promise<ConverseStreamCommandOutput>;
  destroy?(): void;
}

export const BEDROCK_CAPABILITIES: ProviderCapabilities = {
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

const BEDROCK_METADATA: ProviderMetadata<"ModelProvider"> = {
  providerId: "aws-bedrock",
  interfaceName: "ModelProvider",
  displayName: "AWS Bedrock Converse",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.aws.bedrock",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "aws-bedrock-v1",
    rollbackSupported: true,
  },
};

export class AwsBedrockModelProvider implements ModelProvider {
  readonly metadata = BEDROCK_METADATA;
  readonly capabilities = BEDROCK_CAPABILITIES;

  readonly #client: BedrockRuntimeCommandClient;
  readonly #now: () => Date;

  constructor(
    config: AwsBedrockModelProviderConfig,
    client?: BedrockRuntimeCommandClient,
    now?: () => Date,
  ) {
    this.#client =
      client ?? new BedrockRuntimeClient({ region: config.region });
    this.#now = now ?? (() => new Date());
  }

  async invoke(
    request: ModelInvocationRequest,
  ): Promise<ModelInvocationResult> {
    const response = await this.#client.send(
      new ConverseCommand({
        modelId: request.modelId,
        ...converseInput(request),
      }),
    );

    const content = response.output?.message?.content?.[0]?.text;
    if (content === undefined) {
      throw new Error(
        "Bedrock Converse response contained no message text content",
      );
    }

    const result: ModelInvocationResultPayload = {
      message: { role: "assistant", content },
      stop_reason: response.stopReason ?? "unknown",
    };
    const usage: ModelInvocationUsage = {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
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
    const response = await this.#client.send(
      new ConverseStreamCommand({
        modelId: request.modelId,
        ...converseInput(request),
      }),
    );
    if (response.stream === undefined) {
      throw new Error("Bedrock ConverseStream response contained no event stream");
    }

    let sequence = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const event of response.stream) {
      const failure = bedrockStreamFailure(event);
      if (failure !== undefined) {
        throw failure;
      }
      const delta = event.contentBlockDelta?.delta?.text;
      if (delta !== undefined && delta.length > 0) {
        sequence += 1;
        yield {
          sequence,
          delta,
          final: false,
          servedBy: this.metadata.providerId,
        };
      }
      inputTokens = event.metadata?.usage?.inputTokens ?? inputTokens;
      outputTokens = event.metadata?.usage?.outputTokens ?? outputTokens;
    }
    if (sequence === 0) {
      throw new Error("Bedrock ConverseStream returned no text deltas");
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
    // Bedrock Runtime has no no-op ping; a real Converse call spends tokens
    // on every poll. Matches AwsSecretsManagerProvider's precedent: report
    // healthy once the client is constructed, don't spend money to verify.
    return {
      status: "healthy",
      checkedAt: this.#now().toISOString(),
      latencyMs: 0,
      details: { configured: true },
    };
  }

  close(): void {
    this.#client.destroy?.();
  }
}

function converseInput(request: ModelInvocationRequest) {
  const payload = ModelInvocationPayloadSchema.parse(
    JSON.parse(request.inputJson),
  );
  const systemPrompts = payload.messages
    .filter((message) => message.role === "system")
    .map((message) => ({ text: message.content }));
  const messages = payload.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: [{ text: message.content }],
    }));
  return {
    messages,
    ...(systemPrompts.length === 0 ? {} : { system: systemPrompts }),
    inferenceConfig: {
      ...(payload.max_tokens === undefined
        ? {}
        : { maxTokens: payload.max_tokens }),
      ...(payload.temperature === undefined
        ? {}
        : { temperature: payload.temperature }),
    },
  };
}

function bedrockStreamFailure(event: ConverseStreamOutput): Error | undefined {
  const failure =
    event.internalServerException ??
    event.modelStreamErrorException ??
    event.serviceUnavailableException ??
    event.throttlingException ??
    event.validationException;
  return failure === undefined
    ? undefined
    : new Error(failure.message ?? "Bedrock ConverseStream failed");
}
