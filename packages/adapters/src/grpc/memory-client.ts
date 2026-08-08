import { credentials, loadPackageDefinition, Metadata, status, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

export interface ProposeWritebackRequest {
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly run_id: string;
  readonly verified_output_artifact_id: string;
  readonly namespace: string;
}

export interface ProposeWritebackResponse {
  readonly memory_id: string;
  readonly candidate_json: string;
}

export interface MemoryServiceClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly authorization: string;
  readonly timeoutMs?: number;
}

export interface MemoryWritebackHandler {
  proposeWriteback(request: ProposeWritebackRequest): Promise<ProposeWritebackResponse>;
}

type MemoryServiceErrorCode = "invalid_argument" | "not_found" | "deadline_exceeded" | "upstream";

export class MemoryServiceClientError extends Error {
  constructor(readonly code: MemoryServiceErrorCode) {
    super("Memory Service request failed");
  }
}

interface MemoryGrpcClient extends Client {
  proposeWriteback(
    request: ProposeWritebackRequest,
    metadata: Metadata,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: ProposeWritebackResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class MemoryServiceClient implements MemoryWritebackHandler {
  readonly #client: MemoryGrpcClient;
  readonly #timeoutMs: number;
  readonly #metadata: Metadata;

  constructor(config: MemoryServiceClientConfig, client?: MemoryGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#metadata = new Metadata();
    this.#metadata.set("authorization", config.authorization);
    this.#client = client ?? MemoryServiceClient.#buildClient(config);
  }

  static #buildClient(config: MemoryServiceClientConfig): MemoryGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
    });
    const proto = loadPackageDefinition(packageDefinition) as unknown as {
      alter: { memory: { v1: { MemoryService: new (
        address: string, creds: ReturnType<typeof credentials.createInsecure>,
      ) => MemoryGrpcClient } } };
    };
    return new proto.alter.memory.v1.MemoryService(config.address, credentials.createInsecure());
  }

  proposeWriteback(request: ProposeWritebackRequest): Promise<ProposeWritebackResponse> {
    return new Promise((resolve, reject) => {
      this.#client.proposeWriteback(
        request,
        this.#metadata,
        { deadline: new Date(Date.now() + this.#timeoutMs) },
        (error, response) => {
          if (error !== null) {
            reject(new MemoryServiceClientError(errorCode(error)));
          } else if (response === undefined) {
            reject(new MemoryServiceClientError("upstream"));
          } else {
            resolve(response);
          }
        },
      );
    });
  }
}

function errorCode(error: Error): MemoryServiceErrorCode {
  const code = (error as Error & { code?: unknown }).code;
  if (code === status.INVALID_ARGUMENT) return "invalid_argument";
  if (code === status.NOT_FOUND) return "not_found";
  if (code === status.DEADLINE_EXCEEDED) return "deadline_exceeded";
  return "upstream";
}
