import { randomUUID } from "node:crypto";

import { Controller, Get, HttpException, Param, Req } from "@nestjs/common";
import type { SessionGatewayRequest } from "@alterx/auth";
import type { ProblemDetails } from "@alterx/contracts";
import {
  RunOutcomeNotCompletedError,
  RunOutcomeRunNotFoundError,
  RunOutcomeService,
  RunOutcomeValidationError,
} from "./run-outcome.service";

@Controller("internal/runs")
export class RunLearningController {
  constructor(private readonly outcomes: RunOutcomeService) {}

  @Get(":id/outcome-summary")
  async summary(
    @Req() request: SessionGatewayRequest,
    @Param("id") runId: string,
  ) {
    const tenantId = request.actorContext?.tenant_id;
    if (tenantId === undefined) {
      throw new HttpException(
        problem(request.url, 500, "RUN_LEARNING_INTERNAL", "Missing authenticated tenant context"),
        500,
      );
    }
    try {
      return await this.outcomes.getLearningSummary(tenantId, runId);
    } catch (error: unknown) {
      if (error instanceof RunOutcomeValidationError) {
        throw new HttpException(
          problem(request.url, 400, "RUN_LEARNING_VALIDATION_FAILED", error.message),
          400,
        );
      }
      if (error instanceof RunOutcomeRunNotFoundError) {
        throw new HttpException(
          problem(request.url, 404, "RUN_NOT_FOUND", error.message),
          404,
        );
      }
      if (error instanceof RunOutcomeNotCompletedError) {
        throw new HttpException(
          problem(request.url, 409, "RUN_NOT_COMPLETED", error.message),
          409,
        );
      }
      throw new HttpException(
        problem(request.url, 500, "RUN_LEARNING_INTERNAL", "Run summary could not be loaded"),
        500,
      );
    }
  }
}

function problem(
  instance: string | undefined,
  status: 400 | 404 | 409 | 500,
  errorCode: string,
  detail: string,
): ProblemDetails {
  const id = randomUUID();
  const requestId = randomUUID();
  return {
    type: `https://alter.dev/problems/${errorCode.toLowerCase().replaceAll("_", "-")}`,
    title:
      status === 400 ? "Bad Request"
      : status === 404 ? "Not Found"
      : status === 409 ? "Conflict"
      : "Internal Server Error",
    status,
    detail,
    instance: instance?.startsWith("/") ? instance : "/",
    error_code: errorCode,
    trace_id: `trc_${id.slice(0, 14)}7${id.slice(15)}`,
    request_id: `req_${requestId.slice(0, 14)}7${requestId.slice(15)}`,
    retryable: status === 500,
    field_errors: [],
    documentation_key: "memory.run-outcome-summary",
  };
}
