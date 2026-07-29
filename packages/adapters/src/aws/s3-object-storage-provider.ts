import {
  DeleteObjectCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  ObjectStorageProvider,
  ProviderHealth,
  ProviderMetadata,
} from "@alterx/shared-clients";

export interface S3CommandClient {
  send(command: DeleteObjectCommand | HeadObjectCommand): Promise<unknown>;
}

export interface S3ObjectStorageProviderConfig {
  readonly region: string;
  readonly endpoint?: string;
  readonly forcePathStyle?: boolean;
  readonly client?: S3CommandClient;
}

const CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 5_497_558_138_880,
  supported_languages: [],
  cost_model: { rates: [] },
};

function parseReference(reference: string): { bucket: string; key: string } {
  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    throw new Error("Object reference must be a valid s3:// URL");
  }
  const bucket = url.hostname;
  const key = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (url.protocol !== "s3:" || bucket.length === 0 || key.length === 0) {
    throw new Error("Object reference must be a valid s3:// URL");
  }
  return { bucket, key };
}

export class S3ObjectStorageProvider implements ObjectStorageProvider {
  readonly metadata: ProviderMetadata<"ObjectStorageProvider"> = {
    providerId: "aws.s3",
    interfaceName: "ObjectStorageProvider",
    displayName: "AWS S3 Object Storage",
    version: "know16-v1",
    telemetryNamespace: "alterx.adapters.aws.s3",
    supportsTenantOverrides: false,
    migration: { strategyVersion: "s3-v1", rollbackSupported: false },
  };
  readonly capabilities = CAPABILITIES;
  readonly #client: S3CommandClient;

  constructor(config: S3ObjectStorageProviderConfig) {
    if (config.region.trim().length === 0) throw new Error("region is required");
    const sdkConfig: S3ClientConfig = {
      region: config.region,
      ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
      ...(config.forcePathStyle === undefined
        ? {}
        : { forcePathStyle: config.forcePathStyle }),
    };
    this.#client = config.client ?? new S3Client(sdkConfig);
  }

  async deleteObject(reference: string): Promise<void> {
    const { bucket, key } = parseReference(reference);
    await this.#client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async objectExists(reference: string): Promise<boolean> {
    const { bucket, key } = parseReference(reference);
    try {
      await this.#client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error: unknown) {
      if (error instanceof NotFound || (isAwsError(error) && error.$metadata?.httpStatusCode === 404)) {
        return false;
      }
      throw error;
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { status: "healthy", checkedAt: new Date().toISOString(), latencyMs: 0 };
  }
}

function isAwsError(value: unknown): value is { $metadata?: { httpStatusCode?: number } } {
  return typeof value === "object" && value !== null;
}
