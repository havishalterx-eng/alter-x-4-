import {
  credentials,
  loadPackageDefinition,
  type Client,
  type ClientReadableStream,
  type Metadata,
} from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  ModelgwInvokeRequest,
  ModelgwInvokeResponse,
  ModelgwStreamRequest,
  ModelgwStreamResponse,
} from "@alterx/contracts";
import {
  serviceAuthorizationMetadata,
  type ServiceAccessTokenProvider,
} from "./service-auth";

export interface ModelGatewayClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
  readonly streamTimeoutMs?: number;
  readonly accessTokenProvider?: ServiceAccessTokenProvider;
}

export interface ModelGatewayHandler {
  invoke(request: ModelgwInvokeRequest): Promise<ModelgwInvokeResponse>;
}

export interface ModelGatewayStreamHandler {
  stream(request: ModelgwStreamRequest): AsyncIterable<ModelgwStreamResponse>;
}

interface ModelgwGrpcClient extends Client {
  invoke(
    request: ModelgwInvokeRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: ModelgwInvokeResponse) => void,
  ): void;
  invoke(
    request: ModelgwInvokeRequest,
    metadata: Metadata,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: ModelgwInvokeResponse) => void,
  ): void;
  stream(
    request: ModelgwStreamRequest,
    options: { readonly deadline: Date },
  ): ClientReadableStream<ModelgwStreamResponse>;
  stream(
    request: ModelgwStreamRequest,
    metadata: Metadata,
    options: { readonly deadline: Date },
  ): ClientReadableStream<ModelgwStreamResponse>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STREAM_TIMEOUT_MS = 120_000;

export class ModelGatewayClient
  implements ModelGatewayHandler, ModelGatewayStreamHandler
{
  readonly #client: ModelgwGrpcClient;
  readonly #timeoutMs: number;
  readonly #streamTimeoutMs: number;
  readonly #accessTokenProvider: ServiceAccessTokenProvider | undefined;

  constructor(config: ModelGatewayClientConfig, client?: ModelgwGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#streamTimeoutMs =
      config.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
    this.#accessTokenProvider = config.accessTokenProvider;
    this.#client = client ?? ModelGatewayClient.#buildClient(config);
  }

  static #buildClient(config: ModelGatewayClientConfig): ModelgwGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(packageDefinition) as unknown as {
      alter: {
        modelgw: {
          v1: {
            ModelgwService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => ModelgwGrpcClient;
          };
        };
      };
    };
    return new proto.alter.modelgw.v1.ModelgwService(
      config.address,
      credentials.createInsecure(),
    );
  }

  async invoke(request: ModelgwInvokeRequest): Promise<ModelgwInvokeResponse> {
    return new Promise<ModelgwInvokeResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      const callback = (error: Error | null, response?: ModelgwInvokeResponse) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Model Gateway returned an empty response"));
          return;
        }
        resolve(response);
      };
      if (this.#accessTokenProvider === undefined) this.#client.invoke(request, { deadline }, callback);
      else void serviceAuthorizationMetadata(this.#accessTokenProvider).then((metadata) => this.#client.invoke(request, metadata, { deadline }, callback), reject);
    });
  }

  async *stream(
    request: ModelgwStreamRequest,
  ): AsyncIterable<ModelgwStreamResponse> {
    const deadline = new Date(Date.now() + this.#streamTimeoutMs);
    const call = this.#accessTokenProvider === undefined
      ? this.#client.stream(request, { deadline })
      : this.#client.stream(request, await serviceAuthorizationMetadata(this.#accessTokenProvider), { deadline });
    let completed = false;
    try {
      for await (const response of call) {
        yield response;
      }
      completed = true;
    } finally {
      if (!completed) {
        call.cancel();
      }
    }
  }
}
