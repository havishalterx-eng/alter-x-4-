import { credentials, loadPackageDefinition, type Client, type Metadata } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  CostIngestCostEventRequest,
  CostIngestCostEventResponse,
} from "@alterx/contracts";
import { serviceAuthorizationMetadata, type ServiceAccessTokenProvider } from "./service-auth";

export interface CostClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
  readonly accessTokenProvider?: ServiceAccessTokenProvider;
}

export interface CostHandlerClient {
  ingestCostEvent(
    request: CostIngestCostEventRequest,
  ): Promise<CostIngestCostEventResponse>;
}

interface CostGrpcClient extends Client {
  ingestCostEvent(request: CostIngestCostEventRequest, options: { readonly deadline: Date }, callback: (error: Error | null, response?: CostIngestCostEventResponse) => void): void;
  ingestCostEvent(
    request: CostIngestCostEventRequest,
    metadata: Metadata,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: CostIngestCostEventResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class CostClient implements CostHandlerClient {
  readonly #client: CostGrpcClient;
  readonly #timeoutMs: number;
  readonly #accessTokenProvider: ServiceAccessTokenProvider | undefined;

  constructor(config: CostClientConfig, client?: CostGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#accessTokenProvider = config.accessTokenProvider;
    this.#client = client ?? CostClient.#buildClient(config);
  }

  static #buildClient(config: CostClientConfig): CostGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(packageDefinition) as unknown as {
      alter: {
        cost: {
          v1: {
            CostService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => CostGrpcClient;
          };
        };
      };
    };
    return new proto.alter.cost.v1.CostService(
      config.address,
      credentials.createInsecure(),
    );
  }

  async ingestCostEvent(
    request: CostIngestCostEventRequest,
  ): Promise<CostIngestCostEventResponse> {
    return new Promise<CostIngestCostEventResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      const callback = (error: Error | null, response?: CostIngestCostEventResponse) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Cost Service returned an empty response"));
          return;
        }
        resolve(response);
      };
      if (this.#accessTokenProvider === undefined) this.#client.ingestCostEvent(request, { deadline }, callback);
      else void serviceAuthorizationMetadata(this.#accessTokenProvider).then((metadata) => this.#client.ingestCostEvent(request, metadata, { deadline }, callback), reject);
    });
  }
}
