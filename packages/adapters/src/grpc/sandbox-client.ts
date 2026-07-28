import {
  credentials,
  loadPackageDefinition,
  status,
  type Client,
} from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  SandboxExecuteRequest,
  SandboxExecuteResponse,
} from "@alterx/contracts";

export interface SandboxServiceClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
}

export interface SandboxExecuteHandler {
  execute(request: SandboxExecuteRequest): Promise<SandboxExecuteResponse>;
}

export class SandboxServiceClientError extends Error {
  constructor(
    readonly retryable: boolean,
    options: ErrorOptions = {},
  ) {
    super("Sandbox Service request failed", options);
    this.name = "SandboxServiceClientError";
  }
}

interface SandboxGrpcClient extends Client {
  execute(
    request: SandboxExecuteRequest,
    options: { readonly deadline: Date },
    callback: (
      error: (Error & { readonly code?: number }) | null,
      response?: SandboxExecuteResponse,
    ) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Outbound Engine -> Sandbox Service gRPC client, matching gateway clients. */
export class SandboxServiceClient implements SandboxExecuteHandler {
  readonly #client: SandboxGrpcClient;
  readonly #timeoutMs: number;

  constructor(config: SandboxServiceClientConfig, client?: SandboxGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#client = client ?? SandboxServiceClient.#buildClient(config);
  }

  static #buildClient(config: SandboxServiceClientConfig): SandboxGrpcClient {
    const definition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(definition) as unknown as {
      alter: {
        sandbox: {
          v1: {
            SandboxService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => SandboxGrpcClient;
          };
        };
      };
    };
    return new proto.alter.sandbox.v1.SandboxService(
      config.address,
      credentials.createInsecure(),
    );
  }

  async execute(
    request: SandboxExecuteRequest,
  ): Promise<SandboxExecuteResponse> {
    return new Promise((resolve, reject) => {
      this.#client.execute(
        request,
        { deadline: new Date(Date.now() + this.#timeoutMs) },
        (error, response) => {
          if (error !== null) {
            reject(
              new SandboxServiceClientError(
                error.code === status.DEADLINE_EXCEEDED ||
                  error.code === status.UNAVAILABLE,
                { cause: error },
              ),
            );
            return;
          }
          if (response === undefined) {
            reject(new SandboxServiceClientError(false));
            return;
          }
          resolve(response);
        },
      );
    });
  }
}
