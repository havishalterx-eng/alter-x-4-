import { credentials, loadPackageDefinition, status, type Client } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { join } from "node:path";
import { existsSync } from "node:fs";

import type {
  CompilerCompileWorkflowRequest,
  CompilerCompileWorkflowResponse,
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
    super(`Compiler Service request failed: ${code}`);
  }
}

interface CompilerGrpcClient extends Client {
  compileWorkflow(
    request: CompilerCompileWorkflowRequest,
    options: { readonly deadline: Date },
    callback: (error: Error | null, response?: CompilerCompileWorkflowResponse) => void,
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

export function getCompilerProtoPath(): string {
  const workspacePath = join(process.cwd(), "packages/contracts/proto/alter/compiler/v1/compiler.proto");
  return existsSync(workspacePath) ? workspacePath : join(__dirname, "../../../../../packages/contracts/proto/alter/compiler/v1/compiler.proto");
}
