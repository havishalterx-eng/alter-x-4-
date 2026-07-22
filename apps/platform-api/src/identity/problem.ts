export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  error_code: string;
  trace_id: string;
  request_id: string;
  retryable: boolean;
  field_errors: Array<{ field: string; message: string }>;
  documentation_key: string;
}

export class IdentityHttpError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function problemDetails(
  error: unknown,
  instance: string,
  requestId: string | undefined,
): ProblemDetails {
  const identityError =
    error instanceof IdentityHttpError
      ? error
      : new IdentityHttpError(500, "IDENTITY_UNEXPECTED_ERROR", "Identity request failed");

  return {
    type: `https://docs.alter.local/problems/${identityError.errorCode}`,
    title: identityError.errorCode,
    status: identityError.status,
    detail: identityError.message,
    instance,
    error_code: identityError.errorCode,
    trace_id: requestId ?? "trace-unavailable",
    request_id: requestId ?? "request-unavailable",
    retryable: identityError.retryable,
    field_errors: [],
    documentation_key: identityError.errorCode,
  };
}
