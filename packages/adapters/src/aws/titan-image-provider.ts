import { randomUUID } from "node:crypto";

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageGenProvider,
  JsonValue,
  ObjectStorageProvider,
  ProviderHealth,
  ProviderMetadata,
} from "@alterx/shared-clients";

export const TITAN_IMAGE_GENERATOR_V2_MODEL_ID =
  "amazon.titan-image-generator-v2:0";

// Titan Image Generator's InvokeModel request/response shape, verified
// against AWS's own documentation (not guessed):
// https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-titan-image.html
// https://docs.aws.amazon.com/bedrock/latest/userguide/titan-image-models.html
//
// Confirmed there:
// - request: {taskType: "TEXT_IMAGE", textToImageParams: {text, negativeText?},
//   imageGenerationConfig: {quality?, numberOfImages?, height?, width?, cfgScale?, seed?}}
// - response: {images: ["<base64 PNG>", ...], error?: string}
// - prompt text and negativeText are each capped at 512 characters
// - height/width default to 1408 and the longer side must stay <= 1408px
//
// Titan additionally restricts height/width to a fixed table of discrete
// pixel pairs beyond that longer-side bound (documented on the same page
// as a rendered table this tooling could not extract as text). Rather
// than hardcode a guessed pair table, this adapter enforces every bound
// confirmed above and lets an invalid pair reach Bedrock, whose real
// ValidationException is surfaced as-is by #parseTitanImageResponse --
// a real, undisguised error, not a silently-accepted bad request.
export interface TitanImageProviderConfig {
  readonly region: string;
  readonly modelId?: string;
  readonly bucketName: string;
}

export interface BedrockRuntimeCommandClient {
  send(command: InvokeModelCommand): Promise<InvokeModelCommandOutput>;
  destroy?(): void;
}

export const TITAN_IMAGE_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: false,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 10_485_760,
  supported_languages: ["en"],
  cost_model: { rates: [] },
};

const TITAN_IMAGE_METADATA: ProviderMetadata<"ImageGenProvider"> = {
  providerId: "aws-bedrock-titan-image",
  interfaceName: "ImageGenProvider",
  displayName: "AWS Bedrock Titan Image Generator",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.aws.bedrock.titan_image",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "aws-bedrock-titan-image-v1",
    rollbackSupported: true,
  },
};

const MAX_PROMPT_LENGTH = 512;
const MAX_IMAGE_SIDE_PX = 1408;
const DEFAULT_IMAGE_SIDE_PX = 1408;

interface TitanImageResponse {
  readonly images?: unknown;
  readonly error?: unknown;
}

export class TitanImageProvider implements ImageGenProvider {
  readonly metadata = TITAN_IMAGE_METADATA;
  readonly capabilities = TITAN_IMAGE_CAPABILITIES;

  readonly #client: BedrockRuntimeCommandClient;
  readonly #modelId: string;
  readonly #bucketName: string;
  readonly #objectStorage: ObjectStorageProvider;
  readonly #now: () => Date;

  constructor(
    config: TitanImageProviderConfig,
    objectStorage: ObjectStorageProvider,
    client?: BedrockRuntimeCommandClient,
    now?: () => Date,
  ) {
    if (config.region.trim().length === 0) {
      throw new Error("Bedrock region is required");
    }
    if (config.modelId !== undefined && config.modelId.trim().length === 0) {
      throw new Error("Bedrock model ID is required");
    }
    if (config.bucketName.trim().length === 0) {
      throw new Error("Titan image bucket name is required");
    }
    this.#modelId = config.modelId ?? TITAN_IMAGE_GENERATOR_V2_MODEL_ID;
    this.#bucketName = config.bucketName;
    this.#objectStorage = objectStorage;
    this.#client =
      client ?? new BedrockRuntimeClient({ region: config.region });
    this.#now = now ?? (() => new Date());
  }

  async generateImage(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    const { width, height, requestBody } = buildTitanRequest(request);
    const body = new TextEncoder().encode(JSON.stringify(requestBody));
    const response = await this.#client.send(
      new InvokeModelCommand({
        modelId: this.#modelId,
        contentType: "application/json",
        accept: "application/json",
        body,
      }),
    );
    const imageBytes = parseTitanImageResponse(response);

    const reference = `s3://${this.#bucketName}/tenants/${request.tenantId}/media/images/${newImageId()}.png`;
    await this.#objectStorage.putObject(reference, imageBytes, "image/png");

    return {
      reference,
      mimeType: "image/png",
      width,
      height,
      servedBy: this.metadata.providerId,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    // Bedrock image generation costs real money per call, same reasoning
    // as AwsBedrockModelProvider.healthCheck: report healthy once
    // constructed, don't spend money on a live probe.
    return {
      status: "healthy",
      checkedAt: this.#now().toISOString(),
      latencyMs: 0,
      details: { configured: true, modelId: this.#modelId, liveProbe: false },
    };
  }

  close(): void {
    this.#client.destroy?.();
  }
}

function jsonString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function jsonNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function buildTitanRequest(request: ImageGenerationRequest): {
  readonly width: number;
  readonly height: number;
  readonly requestBody: Record<string, unknown>;
} {
  if (request.tenantId.trim().length === 0) {
    throw new Error("Image generation tenantId is required");
  }
  if (request.prompt.trim().length === 0) {
    throw new Error("Image generation prompt is required");
  }
  if (request.prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(
      `Image generation prompt must be ${MAX_PROMPT_LENGTH} characters or fewer`,
    );
  }

  const negativeText = jsonString(request.options.negativeText);
  if (negativeText !== undefined && negativeText.length > MAX_PROMPT_LENGTH) {
    throw new Error(
      `Image generation negativeText must be ${MAX_PROMPT_LENGTH} characters or fewer`,
    );
  }

  const width = jsonNumber(request.options.width) ?? DEFAULT_IMAGE_SIDE_PX;
  const height = jsonNumber(request.options.height) ?? DEFAULT_IMAGE_SIDE_PX;
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0
  ) {
    throw new Error(
      "Image generation width and height must be positive integers",
    );
  }
  if (Math.max(width, height) > MAX_IMAGE_SIDE_PX) {
    throw new Error(
      `Image generation width and height must not exceed ${MAX_IMAGE_SIDE_PX}px on the longer side`,
    );
  }

  const numberOfImages = jsonNumber(request.options.numberOfImages) ?? 1;
  if (!Number.isInteger(numberOfImages) || numberOfImages < 1) {
    throw new Error(
      "Image generation numberOfImages must be a positive integer",
    );
  }

  const cfgScale = jsonNumber(request.options.cfgScale);
  const seed = jsonNumber(request.options.seed);
  const quality = jsonString(request.options.quality);

  return {
    width,
    height,
    requestBody: {
      taskType: "TEXT_IMAGE",
      textToImageParams: {
        text: request.prompt,
        ...(negativeText === undefined ? {} : { negativeText }),
      },
      imageGenerationConfig: {
        numberOfImages,
        height,
        width,
        ...(cfgScale === undefined ? {} : { cfgScale }),
        ...(seed === undefined ? {} : { seed }),
        ...(quality === undefined ? {} : { quality }),
      },
    },
  };
}

function parseTitanImageResponse(response: InvokeModelCommandOutput): Buffer {
  if (response.body === undefined) {
    throw new Error("Bedrock Titan image response body is empty");
  }
  const raw = Buffer.from(response.body).toString("utf8");
  const parsed = JSON.parse(raw) as TitanImageResponse;
  if (typeof parsed.error === "string" && parsed.error.length > 0) {
    throw new Error(`Bedrock Titan image generation error: ${parsed.error}`);
  }
  if (!Array.isArray(parsed.images) || parsed.images.length === 0) {
    throw new Error("Bedrock Titan image response missing images array");
  }
  const [first] = parsed.images as unknown[];
  if (typeof first !== "string" || first.length === 0) {
    throw new Error("Bedrock Titan image response contained an empty image");
  }
  return Buffer.from(first, "base64");
}

// Mirrors apps/orchestration-service/src/artifacts/artifacts.service.ts's
// newArtifactId(): a randomUUID with the version nibble forced to 7, so
// generated IDs stay UUIDv7-shaped like every other ID convention in this
// repo, prefixed for this resource kind instead of inventing a new format.
function newImageId(): string {
  const id = randomUUID();
  return `img_${id.slice(0, 14)}7${id.slice(15)}`;
}
