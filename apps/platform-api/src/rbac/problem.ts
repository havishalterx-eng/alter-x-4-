export interface RbacProblemDetails {
  type: string;
  title: string;
  status: 403;
  detail: string;
  instance: string;
  error_code:
    | "RBAC_PERMISSION_DENIED"
    | "RBAC_TENANT_MISMATCH"
    | "RBAC_ROLE_DENIED";
  trace_id: string;
  request_id: string;
  retryable: false;
  field_errors: [];
  documentation_key: string;
}

export function rbacProblem(
  errorCode: RbacProblemDetails["error_code"],
  instance: string,
): RbacProblemDetails {
  return {
    type: `https://docs.alter.local/problems/${errorCode}`,
    title: errorCode,
    status: 403,
    detail: "Access denied",
    instance,
    error_code: errorCode,
    trace_id: "trace-unavailable",
    request_id: "request-unavailable",
    retryable: false,
    field_errors: [],
    documentation_key: errorCode,
  };
}

export class RbacDeniedError extends Error {
  constructor(readonly problem: RbacProblemDetails) {
    super(problem.error_code);
  }
}
