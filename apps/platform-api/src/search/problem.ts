import { randomUUID } from "node:crypto";
import type { ProblemDetails } from "@alterx/contracts";
import { HttpException } from "@nestjs/common";

export class SearchHttpError extends HttpException {
  constructor(instance: string, detail: string, field: string) {
    super({
      type: "https://errors.alter.ai/invalid-search-request",
      title: "INVALID_SEARCH_REQUEST",
      status: 400,
      detail,
      instance,
      error_code: "INVALID_SEARCH_REQUEST",
      trace_id: `trc_${randomUUID()}`,
      request_id: `req_${randomUUID()}`,
      retryable: false,
      field_errors: [{ field, message: detail }],
      documentation_key: "invalid.search.request",
    } satisfies ProblemDetails, 400);
  }
}
