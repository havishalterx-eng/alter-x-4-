import {
  credentials,
  loadPackageDefinition,
  status,
  type Client,
  type Metadata,
} from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import type {
  ProvisioningCloseCycleRequest,
  ProvisioningCloseCycleResponse,
  ProvisioningProvisionRequest,
  ProvisioningProvisionResponse,
} from "@alterx/contracts";
import { serviceAuthorizationMetadata, type ServiceAccessTokenProvider } from "./service-auth";

export interface ProvisioningClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
  readonly accessTokenProvider?: ServiceAccessTokenProvider;
}

export interface ProvisioningClientHandler {
  provision(
    request: ProvisioningProvisionRequest,
  ): Promise<ProvisioningProvisionResponse>;
  closeCycle(
    request: ProvisioningCloseCycleRequest,
  ): Promise<ProvisioningCloseCycleResponse>;
}

export class ProvisioningClientError extends Error {
  constructor(
    readonly retryable: boolean,
    options: ErrorOptions = {},
  ) {
    super("Provisioning Service request failed", options);
    this.name = "ProvisioningClientError";
  }
}

interface ProvisioningGrpcClient extends Client {
  provision(request: ProvisioningProvisionRequest, options: { readonly deadline: Date }, callback: (error: (Error & { readonly code?: number }) | null, response?: ProvisioningProvisionResponse) => void): void;
  provision(
    request: ProvisioningProvisionRequest,
    metadata: Metadata,
    options: { readonly deadline: Date },
    callback: (
      error: (Error & { readonly code?: number }) | null,
      response?: ProvisioningProvisionResponse,
    ) => void,
  ): void;
  closeCycle(
    request: ProvisioningCloseCycleRequest,
    options: { readonly deadline: Date },
    callback: (
      error: (Error & { readonly code?: number }) | null,
      response?: ProvisioningCloseCycleResponse,
    ) => void,
  ): void;
  closeCycle(
    request: ProvisioningCloseCycleRequest,
    metadata: Metadata,
    options: { readonly deadline: Date },
    callback: (
      error: (Error & { readonly code?: number }) | null,
      response?: ProvisioningCloseCycleResponse,
    ) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class ProvisioningClient implements ProvisioningClientHandler {
  readonly #client: ProvisioningGrpcClient;
  readonly #timeoutMs: number;
  readonly #accessTokenProvider: ServiceAccessTokenProvider | undefined;

  constructor(config: ProvisioningClientConfig, client?: ProvisioningGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#accessTokenProvider = config.accessTokenProvider;
    this.#client = client ?? ProvisioningClient.#build(config);
  }

  static #build(config: ProvisioningClientConfig): ProvisioningGrpcClient {
    const definition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(definition) as unknown as {
      alter: {
        provisioning: {
          v1: {
            ProvisioningService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => ProvisioningGrpcClient;
          };
        };
      };
    };
    return new proto.alter.provisioning.v1.ProvisioningService(
      config.address,
      credentials.createInsecure(),
    );
  }

  provision(
    request: ProvisioningProvisionRequest,
  ): Promise<ProvisioningProvisionResponse> {
    return this.#call("provision", request);
  }

  closeCycle(
    request: ProvisioningCloseCycleRequest,
  ): Promise<ProvisioningCloseCycleResponse> {
    return this.#call("closeCycle", request);
  }

  close(): void {
    this.#client.close();
  }

  async #call<TRequest, TResponse>(
    method: "provision" | "closeCycle",
    request: TRequest,
  ): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      const callback = (
        error: (Error & { readonly code?: number }) | null,
        response?: TResponse,
      ) => {
        if (error !== null) {
          reject(
            new ProvisioningClientError(
              error.code === status.UNAVAILABLE ||
                error.code === status.DEADLINE_EXCEEDED,
              { cause: error },
            ),
          );
          return;
        }
        if (response === undefined) {
          reject(new ProvisioningClientError(false));
          return;
        }
        resolve(response);
      };
      const options = { deadline: new Date(Date.now() + this.#timeoutMs) };
      if (this.#accessTokenProvider === undefined && method === "provision") {
        this.#client.provision(request as ProvisioningProvisionRequest, options, callback as never);
      } else if (this.#accessTokenProvider === undefined) {
        this.#client.closeCycle(request as ProvisioningCloseCycleRequest, options, callback as never);
      } else if (method === "provision") {
        void serviceAuthorizationMetadata(this.#accessTokenProvider).then((metadata) => this.#client.provision(
          request as ProvisioningProvisionRequest, metadata, options, callback as never,
        ), reject);
      } else {
        void serviceAuthorizationMetadata(this.#accessTokenProvider).then((metadata) => this.#client.closeCycle(
          request as ProvisioningCloseCycleRequest, metadata, options, callback as never,
        ), reject);
      }
    });
  }
}
