import { randomUUID } from "node:crypto";
import { Controller, Get, HttpException, Param, Post, Req } from "@nestjs/common";
import type { SessionGatewayRequest } from "@alterx/auth";
import type { ProblemDetails } from "@alterx/contracts";
import {
  ProjectNotFoundError,
  ProjectReadService,
  ProjectValidationError,
} from "./project-read.service";

function requiredTenantId(request: SessionGatewayRequest): string {
  const tenantId = request.actorContext?.tenant_id;
  if (tenantId === undefined) {
    throw new HttpException(
      internalProblem(request.url, "Missing authenticated tenant context"),
      500,
    );
  }
  return tenantId;
}

@Controller("api/v1/projects")
export class ProjectReadController {
  constructor(private readonly service: ProjectReadService) {}

  @Get(":id")
  async get(@Req() request: SessionGatewayRequest, @Param("id") projectId: string) {
    const tenantId = requiredTenantId(request);
    try {
      return await this.service.getProject(tenantId, projectId);
    } catch (error: unknown) {
      throw mapProjectError(error, request.url);
    }
  }

  @Post(":id/actions/deploy")
  async deploy(@Req() request: SessionGatewayRequest, @Param("id") projectId: string) {
    const tenantId = requiredTenantId(request);
    try {
      return await this.service.createDeployment(tenantId, projectId);
    } catch (error: unknown) {
      throw mapProjectError(error, request.url);
    }
  }
}

function mapProjectError(error: unknown, requestUrl: string | undefined): HttpException {
  if (error instanceof ProjectNotFoundError) {
    return new HttpException(notFoundProblem(requestUrl, error.message), 404);
  }
  if (error instanceof ProjectValidationError) {
    return new HttpException(badRequestProblem(requestUrl, error.message), 400);
  }
  if (error instanceof HttpException) {
    return error;
  }
  return new HttpException(
    internalProblem(requestUrl, "Project request could not be completed"),
    500,
  );
}

function instanceOrRoot(requestUrl: string | undefined): string {
  return requestUrl?.startsWith("/") ? requestUrl : "/";
}

function badRequestProblem(requestUrl: string | undefined, detail: string): ProblemDetails {
  return {
    type: "https://alter.dev/problems/project-validation",
    title: "Bad Request",
    status: 400,
    detail,
    instance: instanceOrRoot(requestUrl),
    error_code: "PROJECT_VALIDATION_FAILED",
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: "projects.validation-failed",
  };
}

function notFoundProblem(requestUrl: string | undefined, detail: string): ProblemDetails {
  return {
    type: "https://alter.dev/problems/project-not-found",
    title: "Not Found",
    status: 404,
    detail,
    instance: instanceOrRoot(requestUrl),
    error_code: "PROJECT_NOT_FOUND",
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: "projects.not-found",
  };
}

function internalProblem(requestUrl: string | undefined, detail: string): ProblemDetails {
  return {
    type: "https://alter.dev/problems/project-internal",
    title: "Internal Server Error",
    status: 500,
    detail,
    instance: instanceOrRoot(requestUrl),
    error_code: "PROJECT_INTERNAL_ERROR",
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: "projects.internal-error",
  };
}

function prefixedUuidV7(prefix: "trc" | "req"): `${typeof prefix}_${string}` {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}` as `${typeof prefix}_${string}`;
}
