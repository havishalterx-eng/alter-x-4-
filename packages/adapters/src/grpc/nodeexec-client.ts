import { credentials, loadPackageDefinition, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  NodeexecExecuteNodeRequest,
  NodeexecExecuteNodeResponse,
  NodeexecFinalizeApprovalNodeRequest,
  NodeexecFinalizeApprovalNodeResponse,
  NodeexecFinalizeRunRequest,
  NodeexecFinalizeRunResponse,
} from "@alterx/contracts";

export interface NodeExecutionClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
}

export interface NodeExecutionHandler {
  executeNode(
    request: NodeexecExecuteNodeRequest,
  ): Promise<NodeexecExecuteNodeResponse>;
  finalizeRun(
    request: NodeexecFinalizeRunRequest,
  ): Promise<NodeexecFinalizeRunResponse>;
  finalizeApprovalNode(
    request: NodeexecFinalizeApprovalNodeRequest,
  ): Promise<NodeexecFinalizeApprovalNodeResponse>;
}

interface NodeexecGrpcClient extends Client {
  executeNode(
    request: NodeexecExecuteNodeRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: NodeexecExecuteNodeResponse) => void,
  ): void;
  finalizeRun(
    request: NodeexecFinalizeRunRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: NodeexecFinalizeRunResponse) => void,
  ): void;
  finalizeApprovalNode(
    request: NodeexecFinalizeApprovalNodeRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: NodeexecFinalizeApprovalNodeResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class NodeExecutionClient implements NodeExecutionHandler {
  readonly #client: NodeexecGrpcClient;
  readonly #timeoutMs: number;

  constructor(config: NodeExecutionClientConfig, client?: NodeexecGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#client = client ?? NodeExecutionClient.#buildClient(config);
  }

  static #buildClient(config: NodeExecutionClientConfig): NodeexecGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(packageDefinition) as unknown as {
      alter: {
        nodeexec: {
          v1: {
            NodeExecutionService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => NodeexecGrpcClient;
          };
        };
      };
    };
    return new proto.alter.nodeexec.v1.NodeExecutionService(
      config.address,
      credentials.createInsecure(),
    );
  }

  async executeNode(
    request: NodeexecExecuteNodeRequest,
  ): Promise<NodeexecExecuteNodeResponse> {
    return new Promise<NodeexecExecuteNodeResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      this.#client.executeNode(request, { deadline }, (error, response) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Node Execution Service returned an empty response"));
          return;
        }
        resolve(response);
      });
    });
  }

  async finalizeRun(
    request: NodeexecFinalizeRunRequest,
  ): Promise<NodeexecFinalizeRunResponse> {
    return new Promise<NodeexecFinalizeRunResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      this.#client.finalizeRun(request, { deadline }, (error, response) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Node Execution Service returned an empty response"));
          return;
        }
        resolve(response);
      });
    });
  }

  async finalizeApprovalNode(
    request: NodeexecFinalizeApprovalNodeRequest,
  ): Promise<NodeexecFinalizeApprovalNodeResponse> {
    return new Promise<NodeexecFinalizeApprovalNodeResponse>((resolve, reject) => {
      const deadline = new Date(Date.now() + this.#timeoutMs);
      this.#client.finalizeApprovalNode(request, { deadline }, (error, response) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (response === undefined) {
          reject(new Error("Node Execution Service returned an empty response"));
          return;
        }
        resolve(response);
      });
    });
  }

  close(): void {
    this.#client.close();
  }
}
