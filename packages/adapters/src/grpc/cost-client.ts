import { credentials, loadPackageDefinition, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  CostIngestCostEventRequest,
  CostIngestCostEventResponse,
} from "@alterx/contracts";

export interface CostClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
}

export interface CostHandlerClient {
  ingestCostEvent(
    request: CostIngestCostEventRequest,
  ): Promise<CostIngestCostEventResponse>;
}

interface CostGrpcClient extends Client {
  ingestCostEvent(
    request: CostIngestCostEventRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: CostIngestCostEventResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class CostClient implements CostHandlerClient {
  readonly #client: CostGrpcClient;
  readonly #timeoutMs: number;

  constructor(config: CostClientConfig, client?: CostGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
      this.#client.ingestCostEvent(request, { deadline }, (error, response) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Cost Service returned an empty response"));
          return;
        }
        resolve(response);
      });
    });
  }
}
