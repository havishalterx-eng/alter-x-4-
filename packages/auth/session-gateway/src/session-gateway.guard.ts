import { randomUUID } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from "@nestjs/common";
import type { ProblemDetails } from "@alterx/contracts";
import type { ActorTokenValidator } from "./actor-token-validator";
import { SESSION_GATEWAY_FEATURE_DECISION } from "./feature-decision";
import type { M2mValidator } from "./m2m-validator";
import {
  SessionGatewayAuthError,
  type SessionGatewayErrorCode,
  type SessionGatewayRequest,
  type SessionGatewayResponse,
  type TenantDatabaseScope,
} from "./types";

const SAFE_DETAILS: Record<SessionGatewayErrorCode, string> = {
  AUTH_INVALID_M2M_TOKEN: "The machine credential is missing or invalid.",
  AUTH_MISSING_ACTOR_TOKEN: "A delegation token is required for this request.",
  AUTH_INVALID_ACTOR_TOKEN: "The delegation token is invalid.",
  AUTH_ACTOR_TOKEN_LIFETIME_EXCEEDED:
    "The delegation token lifetime exceeds the allowed maximum.",
  AUTH_ACTOR_TOKEN_EXPIRED: "The delegation token has expired.",
  AUTH_ACTOR_TOKEN_REPLAY: "The delegation token has already been used.",
};

@Injectable()
export class SessionGatewayGuard implements CanActivate {
  readonly featureDecision = SESSION_GATEWAY_FEATURE_DECISION;

  constructor(
    private readonly m2mValidator: M2mValidator,
    private readonly actorTokenValidator: ActorTokenValidator,
    private readonly databaseScope: TenantDatabaseScope,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<SessionGatewayRequest>();
    const response = http.getResponse<SessionGatewayResponse>();

    try {
      const machine = await this.m2mValidator.validate(
        firstHeader(request.headers.authorization),
      );
      const actor =
        machine.serviceActor ??
        (
          await this.actorTokenValidator.validate(
            requiredActorToken(request.headers),
          )
        ).actorContext;

      request.actorContext = actor;
      request.withTenantDatabase = <T>(
        operation: Parameters<TenantDatabaseScope["withTenant"]>[1],
      ) => this.databaseScope.withTenant(databaseTenantId(actor.tenant_id), operation) as Promise<T>;
      return true;
    } catch (error: unknown) {
      const authError =
        error instanceof SessionGatewayAuthError
          ? error
          : new SessionGatewayAuthError("AUTH_INVALID_ACTOR_TOKEN");
      setProblemContentType(response);
      throw new HttpException(
        problemBody(authError.errorCode, request.url),
        401,
      );
    }
  }
}

function requiredActorToken(
  headers: SessionGatewayRequest["headers"],
): string {
  const token = firstHeader(headers["x-alter-actor-token"]);
  if (!token) {
    throw new SessionGatewayAuthError("AUTH_MISSING_ACTOR_TOKEN");
  }
  return token;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function databaseTenantId(tenantId: string): string {
  return tenantId.startsWith("ten_") ? tenantId.slice(4) : tenantId;
}

function setProblemContentType(response: SessionGatewayResponse): void {
  if (response.header) {
    response.header("content-type", "application/problem+json");
  } else {
    response.setHeader?.("content-type", "application/problem+json");
  }
}

function problemBody(
  errorCode: SessionGatewayErrorCode,
  requestUrl = "/",
): ProblemDetails {
  const key = errorCode.toLowerCase().replaceAll("_", "-");
  return {
    type: `https://alter.dev/problems/${key}`,
    title: "Unauthorized",
    status: 401,
    detail: SAFE_DETAILS[errorCode],
    instance: requestUrl.startsWith("/") ? requestUrl : "/",
    error_code: errorCode,
    trace_id: prefixedUuidV7("trc"),
    request_id: prefixedUuidV7("req"),
    retryable: false,
    field_errors: [],
    documentation_key: `auth.${key}`,
  };
}

function prefixedUuidV7(prefix: "trc" | "req"): `${typeof prefix}_${string}` {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}
