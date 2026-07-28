import { credentials, loadPackageDefinition, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  BlackboardReadValueRequest,
  BlackboardReadValueResponse,
  BlackboardWriteValueRequest,
  BlackboardWriteValueResponse,
} from "@alterx/contracts";

export interface BlackboardClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
}

export interface BlackboardHandlerClient {
  writeValue(
    request: BlackboardWriteValueRequest,
  ): Promise<BlackboardWriteValueResponse>;
  readValue(
    request: BlackboardReadValueRequest,
  ): Promise<BlackboardReadValueResponse>;
}

interface BlackboardGrpcClient extends Client {
  writeValue(
    request: BlackboardWriteValueRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: BlackboardWriteValueResponse) => void,
  ): void;
  readValue(
    request: BlackboardReadValueRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: BlackboardReadValueResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class BlackboardClient implements BlackboardHandlerClient {
  readonly #client: BlackboardGrpcClient;
  readonly #timeoutMs: number;

  constructor(config: BlackboardClientConfig, client?: BlackboardGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#client = client ?? BlackboardClient.#buildClient(config);
  }

  static #buildClient(config: BlackboardClientConfig): BlackboardGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(packageDefinition) as unknown as {
      alter: {
        blackboard: {
          v1: {
            BlackboardService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => BlackboardGrpcClient;
          };
        };
      };
    };
    return new proto.alter.blackboard.v1.BlackboardService(
      config.address,
      credentials.createInsecure(),
    );
  }

  async writeValue(
    request: BlackboardWriteValueRequest,
  ): Promise<BlackboardWriteValueResponse> {
    return new Promise<BlackboardWriteValueResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      this.#client.writeValue(request, { deadline }, (error, response) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(response ?? {});
      });
    });
  }

  async readValue(
    request: BlackboardReadValueRequest,
  ): Promise<BlackboardReadValueResponse> {
    return new Promise<BlackboardReadValueResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      this.#client.readValue(request, { deadline }, (error, response) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Blackboard Service returned an empty response"));
          return;
        }
        resolve(response);
      });
    });
  }
}
