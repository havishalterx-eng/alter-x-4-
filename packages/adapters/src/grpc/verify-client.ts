import { credentials, loadPackageDefinition, Metadata, status, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  ScoreNodeInlineRequest,
  ScoreNodeInlineResponse,
} from "@alterx/contracts";

export interface VerifyServiceClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly authorization: string;
  readonly timeoutMs?: number;
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
  constructor(readonly code: VerifyServiceErrorCode, cause?: string) {
    // Carry the classified code (and the upstream detail when the caller
    // has it) in the message: every caller logs `error.message`, so a
    // fixed string made an auth rejection, a bad request and a genuinely
    // unreachable service indistinguishable in the logs.
    super(
      cause === undefined
        ? `Verify Service request failed (${code})`
        : `Verify Service request failed (${code}): ${cause}`,
    );
  }
}

interface VerifyGrpcClient extends Client {
  scoreNodeInline(
    request: ScoreNodeInlineRequest,
    metadata: Metadata,
    options: { readonly deadline: Date },
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
    this.#metadata.set("authorization", config.authorization);
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
        this.#metadata,
        { deadline: new Date(Date.now() + this.#timeoutMs) },
        (error, response) => {
          if (error !== null) {
            reject(new VerifyServiceClientError(errorCode(error), error.message));
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
