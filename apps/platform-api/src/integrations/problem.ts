import type { ProblemDetails } from "@alterx/contracts";
import { HttpException } from "@nestjs/common";

export class IntegrationHttpError extends HttpException {
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
