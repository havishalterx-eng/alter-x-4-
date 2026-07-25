import { credentials, loadPackageDefinition, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type { ModelgwInvokeRequest, ModelgwInvokeResponse } from "@alterx/contracts";

export interface ModelGatewayClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
}

export interface ModelGatewayHandler {
  invoke(request: ModelgwInvokeRequest): Promise<ModelgwInvokeResponse>;
}

interface ModelgwGrpcClient extends Client {
  invoke(
    request: ModelgwInvokeRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: ModelgwInvokeResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class ModelGatewayClient implements ModelGatewayHandler {
  readonly #client: ModelgwGrpcClient;
  readonly #timeoutMs: number;

  constructor(config: ModelGatewayClientConfig, client?: ModelgwGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#client = client ?? ModelGatewayClient.#buildClient(config);
  }

  static #buildClient(config: ModelGatewayClientConfig): ModelgwGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
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
      this.#client.invoke(request, { deadline }, (error, response) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Model Gateway returned an empty response"));
          return;
        }
        resolve(response);
      });
    });
  }
}
