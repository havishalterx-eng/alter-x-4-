export interface EvalFacadeEnvironment {
  readonly grpcTarget: string;
  readonly tokenHash: string;
}

export const EVAL_FACADE_CONFIG = Symbol("EVAL_FACADE_CONFIG");

export function loadEvalFacadeEnvironment(
  environment: NodeJS.ProcessEnv,
): EvalFacadeEnvironment {
  const grpcTarget = environment.EVAL_SERVICE_GRPC_TARGET?.trim() ?? "";
  if (!grpcTarget) {
    throw new Error("EVAL_SERVICE_GRPC_TARGET is required for the Eval facade");
  }
  const tokenHash = environment.EVAL_FACADE_TOKEN_SHA256?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/i.test(tokenHash)) {
    throw new Error("EVAL_FACADE_TOKEN_SHA256 must be a 64-character SHA-256 fingerprint");
  }
  return { grpcTarget, tokenHash };
}
