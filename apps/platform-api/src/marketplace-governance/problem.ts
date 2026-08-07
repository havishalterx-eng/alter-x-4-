import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { ProblemDetails } from "@alterx/contracts";

export class MarketplaceGovernanceHttpError extends HttpException {
  constructor(status: number, code: string, detail: string, instance: string) {
    super({
      type: `https://errors.alter.ai/${code.toLowerCase().replaceAll("_", "-")}`,
      title: code,
      status,
      detail,
      instance,
      error_code: code,
      trace_id: `trc_${randomUUID()}`,
      request_id: `req_${randomUUID()}`,
      retryable: status >= 500,
      field_errors: [],
      documentation_key: code.toLowerCase().replaceAll("_", "."),
    } satisfies ProblemDetails, status);
  }
}
