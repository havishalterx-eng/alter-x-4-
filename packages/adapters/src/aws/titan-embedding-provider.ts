import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
  ProviderHealth,
  ProviderMetadata,
} from "@alterx/shared-clients";

export const TITAN_TEXT_EMBEDDINGS_V2_MODEL_ID =
  "amazon.titan-embed-text-v2:0";

export interface TitanEmbeddingProviderConfig {
  readonly region: string;
  readonly modelId?: string;
  readonly normalize?: boolean;
}

export interface BedrockRuntimeCommandClient {
  send(command: InvokeModelCommand): Promise<InvokeModelCommandOutput>;
  destroy?(): void;
}

export const TITAN_EMBEDDING_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 50_000,
  supported_languages: ["en"],
  cost_model: { rates: [] },
};

const TITAN_EMBEDDING_METADATA: ProviderMetadata<"EmbeddingProvider"> = {
  providerId: "aws-bedrock-titan-embed-text-v2",
  interfaceName: "EmbeddingProvider",
  displayName: "AWS Bedrock Titan Text Embeddings V2",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.aws.bedrock.titan_embedding",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "aws-bedrock-titan-embedding-v2",
    rollbackSupported: true,
  },
};

interface TitanEmbeddingResponse {
  readonly embedding?: unknown;
}

export class TitanEmbeddingProvider implements EmbeddingProvider {
  readonly metadata = TITAN_EMBEDDING_METADATA;
  readonly capabilities = TITAN_EMBEDDING_CAPABILITIES;

  readonly #client: BedrockRuntimeCommandClient;
  readonly #config: Required<TitanEmbeddingProviderConfig>;
  readonly #now: () => Date;

  constructor(
    config: TitanEmbeddingProviderConfig,
    client?: BedrockRuntimeCommandClient,
    now?: () => Date,
  ) {
    if (config.region.trim().length === 0) {
      throw new Error("Bedrock region is required");
    }
    if (config.modelId !== undefined && config.modelId.trim().length === 0) {
      throw new Error("Bedrock model ID is required");
    }
    this.#config = {
      region: config.region,
      modelId: config.modelId ?? TITAN_TEXT_EMBEDDINGS_V2_MODEL_ID,
      normalize: config.normalize ?? true,
    };
    this.#client =
      client ?? new BedrockRuntimeClient({ region: this.#config.region });
    this.#now = now ?? (() => new Date());
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    validateEmbeddingRequest(request);
    const body = new TextEncoder().encode(
      JSON.stringify({
        inputText: request.text,
        dimensions: request.dimensions,
        normalize: this.#config.normalize,
      }),
    );
    const response = await this.#client.send(
      new InvokeModelCommand({
        modelId: this.#config.modelId,
        contentType: "application/json",
        accept: "application/json",
        body,
      }),
    );
    const parsed = parseTitanEmbeddingResponse(response);
    const vector = parseEmbeddingVector(parsed, request.dimensions);
    return {
      vector,
      dimensions: request.dimensions,
      modelId: this.#config.modelId,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      checkedAt: this.#now().toISOString(),
      latencyMs: 0,
      details: {
        configured: true,
        modelId: this.#config.modelId,
        liveProbe: false,
      },
    };
  }

  close(): void {
    this.#client.destroy?.();
  }
}

function validateEmbeddingRequest(request: EmbeddingRequest): void {
  if (request.tenantId.trim().length === 0) {
    throw new Error("Embedding tenantId is required");
  }
  if (request.text.trim().length === 0) {
    throw new Error("Embedding text is required");
  }
  if (request.dimensions !== 512 && request.dimensions !== 1024) {
    throw new Error("Embedding dimensions must be 512 or 1024");
  }
}

function parseTitanEmbeddingResponse(
  response: InvokeModelCommandOutput,
): TitanEmbeddingResponse {
  if (response.body === undefined) {
    throw new Error("Bedrock Titan embedding response body is empty");
  }
  const raw = Buffer.from(response.body).toString("utf8");
  return JSON.parse(raw) as TitanEmbeddingResponse;
}

function parseEmbeddingVector(
  parsed: TitanEmbeddingResponse,
  expectedDimensions: 512 | 1024,
): readonly number[] {
  if (!Array.isArray(parsed.embedding)) {
    throw new Error("Bedrock Titan embedding response missing embedding array");
  }
  const vector = parsed.embedding.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Bedrock Titan embedding vector contains a non-number");
    }
    return value;
  });
  if (vector.length !== expectedDimensions) {
    throw new Error(
      `Bedrock Titan embedding vector length ${vector.length} did not match requested dimensions ${expectedDimensions}`,
    );
  }
  return Object.freeze(vector);
}
