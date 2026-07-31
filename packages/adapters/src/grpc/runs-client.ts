import { credentials, loadPackageDefinition, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  RunsGetRunWorkspaceRequest,
  RunsGetRunWorkspaceResponse,
} from "@alterx/contracts";

export interface RunsClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
}

export interface RunsHandlerClient {
  getRunWorkspace(
    request: RunsGetRunWorkspaceRequest,
  ): Promise<RunsGetRunWorkspaceResponse>;
}

interface RunsGrpcClient extends Client {
  getRunWorkspace(
    request: RunsGetRunWorkspaceRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: RunsGetRunWorkspaceResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class RunsClient implements RunsHandlerClient {
  readonly #client: RunsGrpcClient;
  readonly #timeoutMs: number;

  constructor(config: RunsClientConfig, client?: RunsGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#client = client ?? RunsClient.#buildClient(config);
  }

  static #buildClient(config: RunsClientConfig): RunsGrpcClient {
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
            RunLookupService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => RunsGrpcClient;
          };
        };
      };
    };
    return new proto.alter.runs.v1.RunLookupService(
      config.address,
      credentials.createInsecure(),
    );
  }

  async getRunWorkspace(
    request: RunsGetRunWorkspaceRequest,
  ): Promise<RunsGetRunWorkspaceResponse> {
    return new Promise<RunsGetRunWorkspaceResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      this.#client.getRunWorkspace(request, { deadline }, (error, response) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Run Lookup Service returned an empty response"));
          return;
        }
        resolve(response);
      });
    });
  }
}
