import { credentials, loadPackageDefinition, status, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  CompilerCompileWorkflowRequest,
  CompilerCompileWorkflowResponse,
  CompilerValidateWorkflowDagRequest,
  CompilerValidateWorkflowDagResponse,
} from "@alterx/contracts";

export interface CompilerServiceClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
}

export interface CompilerServiceHandlerClient {
  compileWorkflow(
    request: CompilerCompileWorkflowRequest,
  ): Promise<CompilerCompileWorkflowResponse>;
  validateWorkflowDag(
    request: CompilerValidateWorkflowDagRequest,
  ): Promise<CompilerValidateWorkflowDagResponse>;
}

type CompilerServiceErrorCode =
  | "invalid_argument"
  | "not_found"
  | "failed_precondition"
  | "aborted"
  | "deadline_exceeded"
  | "upstream";

export class CompilerServiceClientError extends Error {
  constructor(readonly code: CompilerServiceErrorCode) {
    super("Compiler Service request failed");
  }
}

interface CompilerGrpcClient extends Client {
  compileWorkflow(
    request: CompilerCompileWorkflowRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: CompilerCompileWorkflowResponse) => void,
  ): void;
  validateWorkflowDag(
    request: CompilerValidateWorkflowDagRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: CompilerValidateWorkflowDagResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class CompilerServiceClient implements CompilerServiceHandlerClient {
  readonly #client: CompilerGrpcClient;
  readonly #timeoutMs: number;

  constructor(config: CompilerServiceClientConfig, client?: CompilerGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#client = client ?? CompilerServiceClient.#buildClient(config);
  }

  static #buildClient(config: CompilerServiceClientConfig): CompilerGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(packageDefinition) as unknown as {
      alter: {
        compiler: {
          v1: {
            CompilerService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => CompilerGrpcClient;
          };
        };
      };
    };
    return new proto.alter.compiler.v1.CompilerService(config.address, credentials.createInsecure());
  }

  compileWorkflow(
    request: CompilerCompileWorkflowRequest,
  ): Promise<CompilerCompileWorkflowResponse> {
    return this.#request((deadline, callback) =>
      this.#client.compileWorkflow(request, { deadline }, callback),
    );
  }

  validateWorkflowDag(
    request: CompilerValidateWorkflowDagRequest,
  ): Promise<CompilerValidateWorkflowDagResponse> {
    return this.#request((deadline, callback) =>
      this.#client.validateWorkflowDag(request, { deadline }, callback),
    );
  }

  #request<TResponse>(
    call: (
      deadline: Date,
      callback: (error: Error | null, response?: TResponse) => void,
    ) => void,
  ): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      call(new Date(Date.now() + this.#timeoutMs), (error, response) => {
        if (error !== null) {
          reject(new CompilerServiceClientError(errorCode(error)));
          return;
        }
        if (response === undefined) {
          reject(new CompilerServiceClientError("upstream"));
          return;
        }
        resolve(response);
      });
    });
  }
}

function errorCode(error: Error): CompilerServiceErrorCode {
  const code = (error as Error & { code?: unknown }).code;
  if (code === status.INVALID_ARGUMENT) return "invalid_argument";
  if (code === status.NOT_FOUND) return "not_found";
  if (code === status.FAILED_PRECONDITION) return "failed_precondition";
  if (code === status.ABORTED) return "aborted";
  if (code === status.DEADLINE_EXCEEDED) return "deadline_exceeded";
  return "upstream";
}
