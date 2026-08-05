import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import type { ProblemDetails } from "@alterx/contracts";

export class BenchmarksHttpError extends HttpException {
  constructor(
    status: 400,
    errorCode: "BENCHMARKS_VALIDATION_FAILED",
    detail: string,
    instance: string,
  ) {
    super({
      type: `https://errors.alter.ai/${errorCode.toLowerCase().replaceAll("_", "-")}`,
      title: "Bad Request",
      status,
      detail,
      instance,
      error_code: errorCode,
      trace_id: `trc_${randomUUID()}`,
      request_id: `req_${randomUUID()}`,
      retryable: false,
      field_errors: [],
      documentation_key: "benchmarks.validation",
    } satisfies ProblemDetails, status);
  }
}
