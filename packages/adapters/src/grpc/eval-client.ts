import { credentials, loadPackageDefinition, status, type Client, Metadata } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  EvalCheckReleaseGateRequest,
  EvalCheckReleaseGateResponse,
  EvalRunEvaluationRequest,
  EvalRunEvaluationResponse,
} from "@alterx/contracts";

export interface EvalServiceClientConfig {
  readonly address: string;
  readonly protoPath: string;
  readonly timeoutMs?: number;
  /** ENGINE-FIX-P5-SEC-1: internal service credential, sent as
   * `Authorization: Bearer <token>` metadata on every RPC. Required by the
   * eval-service gRPC interceptor in production. */
  readonly authorization?: string;
}

export interface EvalServiceHandlerClient {
  runEvaluation(
    request: Pick<EvalRunEvaluationRequest, "golden_set_name"> &
      Partial<Pick<EvalRunEvaluationRequest, "trigger">>,
  ): Promise<EvalRunEvaluationResponse>;
  checkReleaseGate(
    request: Pick<EvalCheckReleaseGateRequest, "release_gate_key" | "evaluation_run_id">,
  ): Promise<EvalCheckReleaseGateResponse>;
}

type EvalServiceErrorCode =
  | "invalid_argument"
  | "not_found"
  | "failed_precondition"
  | "deadline_exceeded"
  | "upstream";

export class EvalServiceClientError extends Error {
  constructor(readonly code: EvalServiceErrorCode) {
    super("Eval Service request failed");
  }
}

interface EvalGrpcClient extends Client {
  runEvaluation(
    request: Pick<EvalRunEvaluationRequest, "golden_set_name" | "trigger">,
    options: { readonly deadline: Date; readonly metadata?: Metadata },
    callback: (error: Error | null, response?: EvalRunEvaluationResponse) => void,
  ): void;
  checkReleaseGate(
    request: Pick<EvalCheckReleaseGateRequest, "release_gate_key" | "evaluation_run_id">,
    options: { readonly deadline: Date; readonly metadata?: Metadata },
    callback: (error: Error | null, response?: EvalCheckReleaseGateResponse) => void,
  ): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class EvalServiceClient implements EvalServiceHandlerClient {
  readonly #client: EvalGrpcClient;
  readonly #timeoutMs: number;
  readonly #metadata: Metadata;

  constructor(config: EvalServiceClientConfig, client?: EvalGrpcClient) {
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#metadata = new Metadata();
    if (config.authorization) {
      this.#metadata.set("authorization", config.authorization);
    }
    this.#client = client ?? EvalServiceClient.#buildClient(config);
  }

  static #buildClient(config: EvalServiceClientConfig): EvalGrpcClient {
    const packageDefinition = loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = loadPackageDefinition(packageDefinition) as unknown as {
      alter: {
        eval: {
          v1: {
            EvalService: new (
              address: string,
              creds: ReturnType<typeof credentials.createInsecure>,
            ) => EvalGrpcClient;
          };
        };
      };
    };
    return new proto.alter.eval.v1.EvalService(config.address, credentials.createInsecure());
  }

  runEvaluation(
    request: Pick<EvalRunEvaluationRequest, "golden_set_name"> &
      Partial<Pick<EvalRunEvaluationRequest, "trigger">>,
  ): Promise<EvalRunEvaluationResponse> {
    return this.#request((deadline, callback) =>
      this.#client.runEvaluation(
        { golden_set_name: request.golden_set_name, trigger: request.trigger ?? "" },
        { deadline, metadata: this.#metadata },
        callback,
      ),
    );
  }

  checkReleaseGate(
    request: Pick<EvalCheckReleaseGateRequest, "release_gate_key" | "evaluation_run_id">,
  ): Promise<EvalCheckReleaseGateResponse> {
    return this.#request((deadline, callback) =>
      this.#client.checkReleaseGate(request, { deadline, metadata: this.#metadata }, callback),
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
          reject(new EvalServiceClientError(errorCode(error)));
          return;
        }
        if (response === undefined) {
          reject(new EvalServiceClientError("upstream"));
          return;
        }
        resolve(response);
      });
    });
  }
}

function errorCode(error: Error): EvalServiceErrorCode {
  const code = (error as Error & { code?: unknown }).code;
  if (code === status.INVALID_ARGUMENT) return "invalid_argument";
  if (code === status.NOT_FOUND) return "not_found";
  if (code === status.FAILED_PRECONDITION) return "failed_precondition";
  if (code === status.DEADLINE_EXCEEDED) return "deadline_exceeded";
  return "upstream";
}
