import { randomUUID } from "node:crypto";
import { Controller, Get, HttpException, Param, Query, Req } from "@nestjs/common";
import type { SessionGatewayRequest } from "@alterx/auth";
import type { ProblemDetails } from "@alterx/contracts";
import { ArtifactNotFoundError, ArtifactsService, ArtifactValidationError } from "./artifacts.service";

@Controller("api/v1/artifacts")
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get()
  async list(@Req() request: SessionGatewayRequest, @Query("run_id") runId: string | undefined) {
    try {
      return { data: await this.artifacts.list(requiredTenantId(request), requiredQuery(runId)) };
    } catch (error: unknown) {
      throw mapArtifactError(error, request.url);
    }
  }

  @Get(":id")
  async get(@Req() request: SessionGatewayRequest, @Param("id") artifactId: string) {
    try {
      return await this.artifacts.get(requiredTenantId(request), artifactId);
    } catch (error: unknown) {
      throw mapArtifactError(error, request.url);
    }
  }

  @Get(":id/download")
  async download(@Req() request: SessionGatewayRequest, @Param("id") artifactId: string) {
    try {
      return await this.artifacts.download(requiredTenantId(request), artifactId);
    } catch (error: unknown) {
      throw mapArtifactError(error, request.url);
    }
  }
}

function requiredTenantId(request: SessionGatewayRequest): string {
  const tenantId = request.actorContext?.tenant_id;
  if (tenantId === undefined) throw new HttpException(problem(request.url, 500, "ARTIFACTS_INTERNAL", "Missing authenticated tenant context"), 500);
  return tenantId;
}

function requiredQuery(value: string | undefined): string {
  if (value === undefined) throw new ArtifactValidationError("run_id is required");
  return value;
}

function mapArtifactError(error: unknown, url: string | undefined): HttpException {
  if (error instanceof ArtifactValidationError) return new HttpException(problem(url, 400, "ARTIFACTS_VALIDATION_FAILED", error.message), 400);
  if (error instanceof ArtifactNotFoundError) return new HttpException(problem(url, 404, "ARTIFACT_NOT_FOUND", error.message), 404);
  return new HttpException(problem(url, 500, "ARTIFACTS_INTERNAL", "Artifact request could not be completed"), 500);
}

function problem(url: string | undefined, status: 400 | 404 | 500, errorCode: string, detail: string): ProblemDetails {
  const id = randomUUID();
  return { type: `https://alter.dev/problems/${errorCode.toLowerCase().replaceAll("_", "-")}`, title: status === 400 ? "Bad Request" : status === 404 ? "Not Found" : "Internal Server Error", status, detail, instance: url?.startsWith("/") ? url : "/", error_code: errorCode, trace_id: `trc_${id.slice(0, 14)}7${id.slice(15)}`, request_id: `req_${id.slice(0, 14)}7${id.slice(15)}`, retryable: status === 500, field_errors: [], documentation_key: "artifacts.request" };
}
