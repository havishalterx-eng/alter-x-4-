import { credentials, loadPackageDefinition, Metadata, status, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

export interface ResolveNodeRequirementsRequest {
  readonly tenant_id: string;
  readonly run_id: string;
  readonly node_key: string;
  readonly node_type: string;
  readonly node_config_json: string;
}

export interface ResolveNodeRequirementsResponse {
  readonly node_requirements_json: string;
  readonly schema_version: string;
}

export interface CapabilityServiceClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly authorization: string;
  readonly timeoutMs?: number;
}

export interface CapabilityServiceHandlerClient {
  resolveNodeRequirements(request: ResolveNodeRequirementsRequest): Promise<ResolveNodeRequirementsResponse>;
}

interface CapabilityGrpcClient extends Client {
  resolveNodeRequirements(
    request: ResolveNodeRequirementsRequest,
    metadata: Metadata,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: ResolveNodeRequirementsResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 3_000;

export class CapabilityServiceClient implements CapabilityServiceHandlerClient {
  readonly #client: CapabilityGrpcClient;
  readonly #timeoutMs: number;
  readonly #metadata: Metadata;

  constructor(config: CapabilityServiceClientConfig, client?: CapabilityGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#metadata = new Metadata();
    this.#metadata.set("authorization", config.authorization);
    this.#client = client ?? CapabilityServiceClient.#buildClient(config);
  }

  static #buildClient(config: CapabilityServiceClientConfig): CapabilityGrpcClient {
    const definition = loadSync(config.protoPath, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const proto = loadPackageDefinition(definition) as unknown as {
      alter: { capability: { v1: { CapabilityService: new (address: string, creds: ReturnType<typeof credentials.createInsecure>) => CapabilityGrpcClient } } };
    };
    return new proto.alter.capability.v1.CapabilityService(config.address, credentials.createInsecure());
  }

  resolveNodeRequirements(request: ResolveNodeRequirementsRequest): Promise<ResolveNodeRequirementsResponse> {
    return new Promise((resolve, reject) => {
      this.#client.resolveNodeRequirements(request, this.#metadata, { deadline: new Date(Date.now() + this.#timeoutMs) }, (error, response) => {
        if (error !== null) {
          reject(new Error(`Capability Service request failed: ${errorCode(error)}`));
        } else if (response === undefined) {
          reject(new Error("Capability Service returned no response"));
        } else {
          resolve(response);
        }
      });
    });
  }
}

function errorCode(error: Error): string {
  return (error as Error & { code?: unknown }).code === status.INVALID_ARGUMENT ? "invalid_argument" : "upstream";
}
