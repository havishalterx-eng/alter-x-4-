import type { ProblemDetails } from "@alterx/contracts";
import { HttpException } from "@nestjs/common";

export class VoiceHttpError extends HttpException {
  constructor(
    status: number,
    errorCode: string,
    detail: string,
    instance: string,
    fieldErrors: ProblemDetails["field_errors"] = [],
    retryable = false,
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
        retryable,
        field_errors: fieldErrors,
        documentation_key: errorCode,
      } satisfies ProblemDetails,
      status,
    );
  }
}
