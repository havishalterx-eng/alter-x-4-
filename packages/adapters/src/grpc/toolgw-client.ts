import {
  credentials,
  loadPackageDefinition,
  status,
  type Client,
} from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  ToolgwInvokeToolRequest,
  ToolgwInvokeToolResponse,
} from "@alterx/contracts";

export interface ToolGatewayClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
}

export interface ToolGatewayInvokeHandler {
  invoke(request: ToolgwInvokeToolRequest): Promise<ToolgwInvokeToolResponse>;
}

export type ToolGatewayClientErrorKind =
  | "invalid_argument"
  | "permission_denied"
  | "rate_limited"
  | "not_implemented"
  | "deadline_exceeded"
  | "unavailable"
  | "invalid_response"
  | "internal";

export class ToolGatewayClientError extends Error {
  constructor(
    readonly kind: ToolGatewayClientErrorKind,
    readonly retryable: boolean,
    options: ErrorOptions = {},
  ) {
    super(`Tool Gateway request failed: ${kind}`, options);
    this.name = "ToolGatewayClientError";
  }
}

interface ToolgwGrpcClient extends Client {
  invokeTool(
    request: ToolgwInvokeToolRequest,
    options: { readonly deadline: Date },
    callback: (
      error: (Error & { readonly code?: number }) | null,
      response?: ToolgwInvokeToolResponse,
    ) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Outbound Engine -> Tool Gateway gRPC client. Shape intentionally mirrors
 * ModelGatewayClient: insecure internal-channel credentials, proto-loader
 * keepCase, one per-call deadline, and no hidden retries.
 */
export class ToolGatewayClient implements ToolGatewayInvokeHandler {
  readonly #client: ToolgwGrpcClient;
  readonly #timeoutMs: number;

  constructor(config: ToolGatewayClientConfig, client?: ToolgwGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#client = client ?? ToolGatewayClient.#buildClient(config);
  }

  static #buildClient(config: ToolGatewayClientConfig): ToolgwGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(packageDefinition) as unknown as {
      alter: {
        toolgw: {
          v1: {
            ToolgwService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => ToolgwGrpcClient;
          };
        };
      };
    };
    return new proto.alter.toolgw.v1.ToolgwService(
      config.address,
      credentials.createInsecure(),
    );
  }

  async invoke(
    request: ToolgwInvokeToolRequest,
  ): Promise<ToolgwInvokeToolResponse> {
    return new Promise<ToolgwInvokeToolResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      this.#client.invokeTool(request, { deadline }, (error, response) => {
        if (error !== null) {
          reject(mapGrpcError(error));
          return;
        }
        if (response === undefined) {
          reject(
            new ToolGatewayClientError("invalid_response", false),
          );
          return;
        }
        resolve(response);
      });
    });
  }
}

function mapGrpcError(
  error: Error & { readonly code?: number },
): ToolGatewayClientError {
  switch (error.code) {
    case status.INVALID_ARGUMENT:
      return new ToolGatewayClientError("invalid_argument", false, {
        cause: error,
      });
    case status.PERMISSION_DENIED:
      return new ToolGatewayClientError("permission_denied", false, {
        cause: error,
      });
    case status.RESOURCE_EXHAUSTED:
      return new ToolGatewayClientError("rate_limited", true, {
        cause: error,
      });
    case status.UNIMPLEMENTED:
      return new ToolGatewayClientError("not_implemented", false, {
        cause: error,
      });
    case status.DEADLINE_EXCEEDED:
      return new ToolGatewayClientError("deadline_exceeded", true, {
        cause: error,
      });
    case status.UNAVAILABLE:
      return new ToolGatewayClientError("unavailable", true, {
        cause: error,
      });
    default:
      return new ToolGatewayClientError("internal", false, { cause: error });
  }
}
