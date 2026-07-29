import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { SessionGatewayRequest } from "@alterx/auth";
import type { ProblemDetails } from "@alterx/contracts";
import type { FastifyReply } from "fastify";
import {
  RunLauncherService,
  RunNotFoundError,
  RunStartFailedError,
  RunStateConflictError,
  RunValidationError,
  WorkflowNotFoundError,
  type RunRow,
} from "./run-launcher.service";
import {
  RunOutcomeService,
  RunOutcomeRunNotFoundError,
  RunOutcomeValidationError,
  type RunOutcomeRow,
} from "./run-outcome.service";

interface CreateRunBody {
  readonly workflow_id: string;
  readonly workflow_version_id?: string;
}

interface RetryNodeBody {
  readonly node_key: string;
}

interface RunsQuery {
  readonly workflow_id?: string;
  readonly status?: string;
  readonly cursor?: string;
  readonly limit?: string;
}

function requiredTenantId(request: SessionGatewayRequest): string {
  const tenantId = request.actorContext?.tenant_id;
  if (tenantId === undefined) {
    throw new HttpException(internalProblem(request.url, "Missing authenticated tenant context"), 500);
  }
  return tenantId;
}

function toRunResponse(row: RunRow): Record<string, unknown> {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    workflow_version_id: row.workflow_version_id,
    parent_kind: row.parent_kind,
    status: row.status,
    started_at: row.started_at,
    ended_at: row.ended_at,
    created_at: row.created_at,
  };
}

function toOutcomeResponse(row: RunOutcomeRow): Record<string, unknown> {
  return {
    run_id: row.run_id,
    mode: row.mode,
    eligible: row.eligible,
    verdict: row.verdict,
    human_rescue: row.human_rescue,
    critical_external_error: row.critical_external_error,
    gates_passed: row.gates_passed,
    gates_failed: row.gates_failed,
    recovery_count: row.recovery_count,
    human_repair_after_complete: row.human_repair_after_complete,
    decided_at: row.decided_at,
  };
}

@Controller("api/v1/runs")
export class RunsController {
  constructor(
    private readonly launcher: RunLauncherService,
    private readonly outcomes: RunOutcomeService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Req() request: SessionGatewayRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: CreateRunBody,
  ) {
    const tenantId = requiredTenantId(request);
    if (typeof body?.workflow_id !== "string" || body.workflow_id.trim().length === 0) {
      throw badRequest(request.url, "workflow_id is required");
    }
    try {
      const run = await this.launcher.createRun(
        tenantId,
        body.workflow_id,
        body.workflow_version_id,
      );
      reply.header("location", `/api/v1/runs/${run.id}`);
      return toRunResponse(run);
    } catch (error: unknown) {
      throw mapRunError(error, request.url);
    }
  }

  @Get()
  async list(@Req() request: SessionGatewayRequest, @Query() query: RunsQuery) {
    const tenantId = requiredTenantId(request);
    try {
      const page = await this.launcher.listRuns(tenantId, {
        ...(query.workflow_id === undefined ? {} : { workflowId: query.workflow_id }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
      });
      return {
        data: page.data.map(toRunResponse),
        page: page.page,
      };
    } catch (error: unknown) {
      throw mapRunError(error, request.url);
    }
  }

  @Get(":id")
  async get(@Req() request: SessionGatewayRequest, @Param("id") runId: string) {
    const tenantId = requiredTenantId(request);
    try {
      return toRunResponse(await this.launcher.getRun(tenantId, runId));
    } catch (error: unknown) {
      throw mapRunError(error, request.url);
    }
  }

  @Get(":id/outcome")
  async outcome(@Req() request: SessionGatewayRequest, @Param("id") runId: string) {
    const tenantId = requiredTenantId(request);
    try {
      const row = await this.outcomes.getByRunId(tenantId, runId);
      if (row === undefined) {
        throw notFound(
          request.url,
          `Run ${runId} has no recorded outcome yet`,
          "RUN_OUTCOME_NOT_FOUND",
          "runs.outcome-not-found",
        );
      }
      return toOutcomeResponse(row);
    } catch (error: unknown) {
      throw mapRunError(error, request.url);
    }
  }

  @Post(":id/actions/cancel")
  async cancel(@Req() request: SessionGatewayRequest, @Param("id") runId: string) {
    const tenantId = requiredTenantId(request);
    try {
      return toRunResponse(await this.launcher.cancelRun(tenantId, runId));
    } catch (error: unknown) {
      throw mapRunError(error, request.url);
    }
  }

  @Post(":id/actions/retry-node")
  async retryNode(
    @Req() request: SessionGatewayRequest,
    @Param("id") runId: string,
    @Body() body: RetryNodeBody,
  ) {
    const tenantId = requiredTenantId(request);
    if (typeof body?.node_key !== "string" || body.node_key.trim().length === 0) {
      throw badRequest(request.url, "node_key is required");
    }
    try {
      return toRunResponse(await this.launcher.retryNode(tenantId, runId, body.node_key));
    } catch (error: unknown) {
      throw mapRunError(error, request.url);
    }
  }
}

function mapRunError(error: unknown, requestUrl: string | undefined): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof RunValidationError) {
    return badRequest(requestUrl, error.message);
  }
  if (error instanceof RunNotFoundError) {
    return notFound(requestUrl, error.message, "RUN_NOT_FOUND", "runs.not-found");
  }
  if (error instanceof WorkflowNotFoundError) {
    return notFound(requestUrl, error.message, "WORKFLOW_NOT_FOUND", "runs.workflow-not-found");
  }
  if (error instanceof RunStateConflictError) {
    return conflict(requestUrl, error.message);
  }
  if (error instanceof RunOutcomeValidationError) {
    return badRequest(requestUrl, error.message);
  }
  if (error instanceof RunOutcomeRunNotFoundError) {
    return notFound(requestUrl, error.message, "RUN_NOT_FOUND", "runs.not-found");
  }
  if (error instanceof RunStartFailedError) {
    return new HttpException(
      problem(requestUrl, 502, "RUN_START_FAILED", error.message, "runs.start-failed", true),
      502,
    );
  }
  return new HttpException(internalProblem(requestUrl, "Runs request could not be completed"), 500);
}

function badRequest(requestUrl: string | undefined, detail: string): HttpException {
  return new HttpException(
    problem(requestUrl, 400, "RUNS_VALIDATION_FAILED", detail, "runs.validation-failed", false),
    400,
  );
}

function notFound(
  requestUrl: string | undefined,
  detail: string,
  errorCode: string,
  documentationKey: string,
): HttpException {
  return new HttpException(problem(requestUrl, 404, errorCode, detail, documentationKey, false), 404);
}

function conflict(requestUrl: string | undefined, detail: string): HttpException {
  return new HttpException(
    problem(requestUrl, 409, "RUN_STATE_CONFLICT", detail, "runs.state-conflict", false),
    409,
  );
}

function internalProblem(requestUrl: string | undefined, detail: string): ProblemDetails {
  return problem(requestUrl, 500, "RUNS_INTERNAL_ERROR", detail, "runs.internal-error", false);
}

function problem(
  requestUrl: string | undefined,
  status: number,
  errorCode: string,
  detail: string,
  documentationKey: string,
  retryable: boolean,
): ProblemDetails {
  const title =
    status === 400 ? "Bad Request"
    : status === 404 ? "Not Found"
    : status === 409 ? "Conflict"
    : status === 502 ? "Bad Gateway"
    : "Internal Server Error";
  return {
    type: `https://alter.dev/problems/${errorCode.toLowerCase().replaceAll("_", "-")}`,
    title,
    status,
    detail,
    instance: requestUrl?.startsWith("/") ? requestUrl : "/",
    error_code: errorCode,
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable,
    field_errors: [],
    documentation_key: documentationKey,
  };
}

function prefixedUuidV7(prefix: "trc" | "req"): `${typeof prefix}_${string}` {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}` as `${typeof prefix}_${string}`;
}
