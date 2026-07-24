import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelProvider,
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
  readonly invoke?: (
    request: ModelInvocationRequest,
  ) => Promise<ModelInvocationResult>;
}

const DEFAULT_INVOKE = async (
  request: ModelInvocationRequest,
): Promise<ModelInvocationResult> => ({
  outputJson: JSON.stringify({ echo: JSON.parse(request.inputJson) }),
  usageJson: JSON.stringify({
    model_id: request.modelId,
    input_tokens: 0,
    output_tokens: 0,
  }),
});

export function createMockModelProvider(
  options: MockModelProviderOptions = {},
): ModelProvider {
  const providerId = options.providerId ?? "mock.model";

  return createMockProvider<ModelProvider>({
    metadata: options.metadata ?? mockMetadata(providerId, "ModelProvider"),
    capabilities: options.capabilities ?? MOCK_MODEL_CAPABILITIES,
    implementation: {
      invoke: options.invoke ?? DEFAULT_INVOKE,
    },
  });
}
