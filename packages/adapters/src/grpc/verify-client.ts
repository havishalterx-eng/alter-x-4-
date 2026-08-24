import { credentials, loadPackageDefinition, status, type Client, Metadata } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  ScoreNodeInlineRequest,
  ScoreNodeInlineResponse,
} from "@alterx/contracts";

export interface VerifyServiceClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
  /** ENGINE-FIX-P5-SEC-1: internal service credential, sent as
   * `Authorization: Bearer <token>` metadata on every RPC. Required by the
   * verification-service gRPC interceptor in production. */
  readonly authorization?: string;
}

export interface VerifyServiceHandlerClient {
  scoreNodeInline(request: ScoreNodeInlineRequest): Promise<ScoreNodeInlineResponse>;
}

type VerifyServiceErrorCode =
  | "invalid_argument"
  | "not_found"
  | "failed_precondition"
  | "deadline_exceeded"
  | "upstream";

export class VerifyServiceClientError extends Error {
  constructor(readonly code: VerifyServiceErrorCode) {
    super("Verify Service request failed");
  }
}

interface VerifyGrpcClient extends Client {
  scoreNodeInline(
    request: ScoreNodeInlineRequest,
    options: { readonly deadline: Date; readonly metadata?: Metadata },
    callback: (error: Error | null, response?: ScoreNodeInlineResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class VerifyServiceClient implements VerifyServiceHandlerClient {
  readonly #client: VerifyGrpcClient;
  readonly #timeoutMs: number;
  readonly #metadata: Metadata;

  constructor(config: VerifyServiceClientConfig, client?: VerifyGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#metadata = new Metadata();
    if (config.authorization) {
      this.#metadata.set("authorization", config.authorization);
    }
    this.#client = client ?? VerifyServiceClient.#buildClient(config);
  }

  static #buildClient(config: VerifyServiceClientConfig): VerifyGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(packageDefinition) as unknown as {
      alter: {
        verify: {
          v1: {
            VerifyService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => VerifyGrpcClient;
          };
        };
      };
    };
    return new proto.alter.verify.v1.VerifyService(config.address, credentials.createInsecure());
  }

  scoreNodeInline(request: ScoreNodeInlineRequest): Promise<ScoreNodeInlineResponse> {
    return new Promise<ScoreNodeInlineResponse>((resolve, reject) => {
      this.#client.scoreNodeInline(
        request,
        { deadline: new Date(Date.now() + this.#timeoutMs), metadata: this.#metadata },
        (error, response) => {
          if (error !== null) {
            reject(new VerifyServiceClientError(errorCode(error)));
            return;
          }
          if (response === undefined) {
            reject(new VerifyServiceClientError("upstream"));
            return;
          }
          resolve(response);
        },
      );
    });
  }
}

function errorCode(error: Error): VerifyServiceErrorCode {
  const code = (error as Error & { code?: unknown }).code;
  if (code === status.INVALID_ARGUMENT) return "invalid_argument";
  if (code === status.NOT_FOUND) return "not_found";
  if (code === status.FAILED_PRECONDITION) return "failed_precondition";
  if (code === status.DEADLINE_EXCEEDED) return "deadline_exceeded";
  return "upstream";
}
