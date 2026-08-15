import { credentials, loadPackageDefinition, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  RunsCreateRunRequest,
  RunsCreateRunResponse,
} from "@alterx/contracts";

export interface RunDispatchClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
}

export interface RunDispatchHandlerClient {
  createRun(request: RunsCreateRunRequest): Promise<RunsCreateRunResponse>;
}

interface RunDispatchGrpcClient extends Client {
  createRun(
    request: RunsCreateRunRequest,
    options: { readonly deadline: Date },
    callback: (
      error: Error | null,
      response?: RunsCreateRunResponse,
    ) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class RunDispatchClient implements RunDispatchHandlerClient {
  readonly #client: RunDispatchGrpcClient;
  readonly #timeoutMs: number;

  constructor(config: RunDispatchClientConfig, client?: RunDispatchGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#client = client ?? RunDispatchClient.#buildClient(config);
  }

  static #buildClient(config: RunDispatchClientConfig): RunDispatchGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(packageDefinition) as unknown as {
      alter: {
        runs: {
          v1: {
            RunDispatchService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => RunDispatchGrpcClient;
          };
        };
      };
    };
    return new proto.alter.runs.v1.RunDispatchService(
      config.address,
      credentials.createInsecure(),
    );
  }

  async createRun(
    request: RunsCreateRunRequest,
  ): Promise<RunsCreateRunResponse> {
    return new Promise<RunsCreateRunResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      this.#client.createRun(request, { deadline }, (error, response) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Run Dispatch Service returned an empty response"));
          return;
        }
        resolve(response);
      });
    });
  }
}