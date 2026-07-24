import { HttpException } from "@nestjs/common";

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

export class PlatformHttpError extends HttpException {
  constructor(
    status: number,
    errorCode: string,
    detail: string,
    instance: string,
    fieldErrors: ProblemDetails["field_errors"] = [],
  ) {
    super(
      {
        type: `https://errors.alter.ai/${errorCode.toLowerCase()}`,
        title: errorCode,
        status,
        detail,
        instance,
        error_code: errorCode,
        trace_id: "trace-unavailable",
        request_id: "request-unavailable",
        retryable: false,
        field_errors: fieldErrors,
        documentation_key: errorCode,
      } satisfies ProblemDetails,
      status,
    );
  }
}
