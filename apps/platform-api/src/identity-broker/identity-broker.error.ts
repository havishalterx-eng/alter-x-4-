export class IdentityBrokerError extends Error {
  constructor(
    readonly errorCode: "ACTOR_TOKEN_TENANT_MISMATCH" | "ACTOR_TOKEN_MINT_FAILED",
    message = "Actor token minting failed",
  ) {
    super(message);
  }
}

export interface IdentityBrokerProblemDetails {
  type: string;
  title: string;
  status: 403 | 500;
  detail: string;
  instance: string;
  error_code: string;
  trace_id: string;
  request_id: string;
  retryable: false;
  field_errors: [];
  documentation_key: string;
}

export function identityBrokerProblem(
  error: unknown,
  instance: string,
): IdentityBrokerProblemDetails {
  const brokerError =
    error instanceof IdentityBrokerError
      ? error
      : new IdentityBrokerError("ACTOR_TOKEN_MINT_FAILED");

  return {
    type: `https://docs.alter.local/problems/${brokerError.errorCode}`,
    title: brokerError.errorCode,
    status: brokerError.errorCode === "ACTOR_TOKEN_TENANT_MISMATCH" ? 403 : 500,
    detail: brokerError.message,
    instance,
    error_code: brokerError.errorCode,
    trace_id: "trace-unavailable",
    request_id: "request-unavailable",
    retryable: false,
    field_errors: [],
    documentation_key: brokerError.errorCode,
  };
}
