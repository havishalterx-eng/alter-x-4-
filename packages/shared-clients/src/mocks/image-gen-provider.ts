import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageGenProvider,
  ProviderHealth,
  ProviderMetadata,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_IMAGE_GEN_CAPABILITIES: ProviderCapabilities = {
  ...mockCapabilities(10_485_760),
  batch_support: false,
};

export interface MockImageGenProvider extends ImageGenProvider {
  getRequests(): readonly ImageGenerationRequest[];
}

export interface MockImageGenProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"ImageGenProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly health?: ProviderHealth;
  readonly generateImage?: (
    request: ImageGenerationRequest,
  ) => Promise<ImageGenerationResult>;
}

function defaultGenerateImage(
  providerId: string,
  request: ImageGenerationRequest,
): ImageGenerationResult {
  return {
    reference: `mock-image://${encodeURIComponent(request.prompt).slice(0, 64)}`,
    mimeType: "image/png",
    width: 512,
    height: 512,
    servedBy: providerId,
  };
}

export function createMockImageGenProvider(
  options: MockImageGenProviderOptions = {},
): MockImageGenProvider {
  const providerId = options.providerId ?? "mock.image-gen";
  const requests: ImageGenerationRequest[] = [];
  const generateImage =
    options.generateImage ??
    (async (request) => defaultGenerateImage(providerId, request));

  return createMockProvider<MockImageGenProvider>({
    metadata: options.metadata ?? mockMetadata(providerId, "ImageGenProvider"),
    capabilities: options.capabilities ?? MOCK_IMAGE_GEN_CAPABILITIES,
    ...(options.health === undefined ? {} : { health: options.health }),
    implementation: {
      generateImage: async (request) => {
        requests.push({ ...request });
        return generateImage(request);
      },
      getRequests: () => requests.map((request) => ({ ...request })),
    },
  });
}
