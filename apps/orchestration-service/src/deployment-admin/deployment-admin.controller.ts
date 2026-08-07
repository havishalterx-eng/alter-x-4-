import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Body, Controller, Headers, HttpException, Inject, Post } from "@nestjs/common";
import { Public as BypassSessionGatewayActorAuth } from "@alterx/auth";
import {
  DeploymentAdminActionRequestSchema,
  ProblemDetailsSchema,
  type ProblemDetails,
} from "@alterx/contracts";
import {
  DeploymentAdminConflictError,
  DeploymentAdminNotFoundError,
  DeploymentAdminService,
} from "./deployment-admin.service";

export const DEPLOYMENT_ADMIN_TOKEN_HASH = Symbol("DEPLOYMENT_ADMIN_TOKEN_HASH");

@BypassSessionGatewayActorAuth()
@Controller("internal/admin/deployments")
export class DeploymentAdminController {
  constructor(
    private readonly service: DeploymentAdminService,
    @Inject(DEPLOYMENT_ADMIN_TOKEN_HASH) private readonly tokenHash: string,
  ) {}

  @Post("actions/apply")
  async apply(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    this.authorize(authorization);
    const parsed = DeploymentAdminActionRequestSchema.safeParse(body);
    if (!parsed.success) throw failure(400, "DEPLOYMENT_ADMIN_VALIDATION_FAILED");
    try {
      return await this.service.apply(parsed.data);
    } catch (error: unknown) {
      if (error instanceof DeploymentAdminNotFoundError) {
        throw failure(404, "DEPLOYMENT_ADMIN_NOT_FOUND", error.message);
      }
      if (error instanceof DeploymentAdminConflictError) {
        throw failure(409, "DEPLOYMENT_ADMIN_CONFLICT", error.message);
      }
      throw error;
    }
  }

  private authorize(authorization: string | undefined): void {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const actual = createHash("sha256").update(token).digest();
    const expected = Buffer.from(this.tokenHash, "hex");
    if (!token || expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
      throw failure(401, "DEPLOYMENT_ADMIN_AUTHENTICATION_FAILED");
    }
  }
}

function failure(status: number, code: string, detail = code): HttpException {
  const problem: ProblemDetails = ProblemDetailsSchema.parse({
    type: `https://alter.dev/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title: status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Bad Request",
    status,
    detail,
    instance: "/internal/admin/deployments/actions/apply",
    error_code: code,
    trace_id: generatedId("trc"),
    request_id: generatedId("req"),
    retryable: false,
    field_errors: [],
    documentation_key: "deployment.admin",
  });
  return new HttpException(problem, status);
}

function generatedId(prefix: "trc" | "req"): string {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}
