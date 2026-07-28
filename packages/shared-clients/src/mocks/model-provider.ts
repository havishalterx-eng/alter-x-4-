import {
  ModelInvocationPayloadSchema,
  type ProviderCapabilities,
} from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelInvocationStreamChunk,
  ModelProvider,
  ProviderHealth,
  ProviderMetadata,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_MODEL_CAPABILITIES: ProviderCapabilities = {
  ...mockCapabilities(1_048_576),
  streaming: true,
  structured_output: true,
};

export interface MockModelProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"ModelProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly health?: ProviderHealth;
  readonly invoke?: (
    request: ModelInvocationRequest,
  ) => Promise<ModelInvocationResult>;
  readonly stream?: (
    request: ModelInvocationRequest,
  ) => AsyncIterable<ModelInvocationStreamChunk>;
}

function defaultStream(
  providerId: string,
): (request: ModelInvocationRequest) => AsyncIterable<ModelInvocationStreamChunk> {
  return async function* (request) {
    const payload = ModelInvocationPayloadSchema.parse(
      JSON.parse(request.inputJson),
    );
    const lastMessage = payload.messages[payload.messages.length - 1];
    yield {
      sequence: 1,
      delta: `mock response to: ${lastMessage?.content ?? ""}`,
      final: false,
      servedBy: providerId,
    };
    yield {
      sequence: 2,
      delta: "",
      final: true,
      usageJson: JSON.stringify({ input_tokens: 0, output_tokens: 0 }),
      servedBy: providerId,
    };
  };
}

function defaultInvoke(
  providerId: string,
): (request: ModelInvocationRequest) => Promise<ModelInvocationResult> {
  return async (request) => {
    const payload = ModelInvocationPayloadSchema.parse(
      JSON.parse(request.inputJson),
    );
    const lastMessage = payload.messages[payload.messages.length - 1];
    return {
      outputJson: JSON.stringify({
        message: {
          role: "assistant",
          content: `mock response to: ${lastMessage?.content ?? ""}`,
        },
        stop_reason: "end_turn",
      }),
      usageJson: JSON.stringify({ input_tokens: 0, output_tokens: 0 }),
      servedBy: providerId,
    };
  };
}

export function createMockModelProvider(
  options: MockModelProviderOptions = {},
): ModelProvider {
  const providerId = options.providerId ?? "mock.model";

  return createMockProvider<ModelProvider>({
    metadata: options.metadata ?? mockMetadata(providerId, "ModelProvider"),
    capabilities: options.capabilities ?? MOCK_MODEL_CAPABILITIES,
    ...(options.health === undefined ? {} : { health: options.health }),
    implementation: {
      invoke: options.invoke ?? defaultInvoke(providerId),
      stream: options.stream ?? defaultStream(providerId),
    },
  });
}
