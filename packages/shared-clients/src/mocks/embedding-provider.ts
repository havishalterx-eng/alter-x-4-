import { createHash } from "node:crypto";

import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
  ProviderHealth,
  ProviderMetadata,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_EMBEDDING_CAPABILITIES: ProviderCapabilities = {
  ...mockCapabilities(50_000),
  batch_support: false,
};

export interface MockEmbeddingProvider extends EmbeddingProvider {
  getRequests(): readonly EmbeddingRequest[];
}

export interface MockEmbeddingProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"EmbeddingProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly modelId?: string;
  readonly health?: ProviderHealth;
  readonly embed?: (request: EmbeddingRequest) => Promise<EmbeddingResult>;
}

const DEFAULT_MODEL_ID = "mock.embedding";

export function deterministicEmbeddingVector(
  request: EmbeddingRequest,
): readonly number[] {
  return Object.freeze(
    Array.from({ length: request.dimensions }, (_, index) => {
      const digest = createHash("sha256")
        .update(`${request.tenantId}:${request.text}:${request.dimensions}:${index}`)
        .digest();
      return digest.readUInt32BE(0) / 0xffffffff;
    }),
  );
}

export function createMockEmbeddingProvider(
  options: MockEmbeddingProviderOptions = {},
): MockEmbeddingProvider {
  const providerId = options.providerId ?? "mock.embedding";
  const modelId = options.modelId ?? DEFAULT_MODEL_ID;
  const requests: EmbeddingRequest[] = [];
  const embed =
    options.embed ??
    (async (request: EmbeddingRequest): Promise<EmbeddingResult> => ({
      vector: deterministicEmbeddingVector(request),
      dimensions: request.dimensions,
      modelId,
    }));

  return createMockProvider<MockEmbeddingProvider>({
    metadata:
      options.metadata ?? mockMetadata(providerId, "EmbeddingProvider"),
    capabilities: options.capabilities ?? MOCK_EMBEDDING_CAPABILITIES,
    ...(options.health === undefined ? {} : { health: options.health }),
    implementation: {
      embed: async (request) => {
        requests.push({ ...request });
        return embed(request);
      },
      getRequests: () => requests.map((request) => ({ ...request })),
    },
  });
}
