import type { ProblemDetails } from "@alterx/contracts";

export class StreamProblemError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail);
  }
}

export function streamProblem(
  status: 400 | 409,
  errorCode: string,
  instance: string,
): ProblemDetails {
  return {
    type: `https://docs.alter.local/problems/${errorCode}`,
    title: status === 400 ? "Invalid stream request" : "Stream conflict",
    status,
    detail:
      status === 400
        ? "Stream request validation failed."
        : "Stream subscription conflicts with an active connection.",
    instance,
    error_code: errorCode,
    trace_id: "trace-unavailable",
    request_id: "request-unavailable",
    retryable: false,
    field_errors: [],
    documentation_key: errorCode,
  };
}
