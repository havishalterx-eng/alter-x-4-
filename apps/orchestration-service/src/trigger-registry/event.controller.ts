import { randomUUID } from "node:crypto";
import { Controller, Get, HttpException, Param, Query, Req } from "@nestjs/common";
import type { SessionGatewayRequest } from "@alterx/auth";
import type { ProblemDetails } from "@alterx/contracts";
import {
  EventNotFoundError,
  EventQueryService,
  EventValidationError,
  type EventListQuery,
} from "./event-query.service";

interface EventListQueryParams {
  readonly source?: string;
  readonly status?: string;
  readonly cursor?: string;
  readonly limit?: string;
}

@Controller("api/v1/events")
export class EventController {
  constructor(private readonly events: EventQueryService) {}

  @Get()
  async list(@Req() request: SessionGatewayRequest, @Query() query: EventListQueryParams) {
    const tenantId = requireTenant(request);
    const listQuery: EventListQuery = {
      ...(query.source === undefined ? {} : { source: query.source }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
    };
    try {
      return await this.events.list(tenantId, listQuery);
    } catch (error: unknown) {
      throw mapEventError(error, request.url);
    }
  }

  @Get(":id")
  async get(@Req() request: SessionGatewayRequest, @Param("id") eventId: string) {
    const tenantId = requireTenant(request);
    try {
      return await this.events.get(tenantId, eventId);
    } catch (error: unknown) {
      throw mapEventError(error, request.url);
    }
  }
}

function requireTenant(request: SessionGatewayRequest): string {
  const tenantId = request.actorContext?.tenant_id;
  if (tenantId === undefined) {
    throw new HttpException(problem(request.url, 500, "Missing authenticated tenant context"), 500);
  }
  return tenantId;
}

function mapEventError(error: unknown, url: string | undefined): HttpException {
  if (error instanceof EventValidationError) {
    return new HttpException(problem(url, 400, error.message), 400);
  }
  if (error instanceof EventNotFoundError) {
    return new HttpException(problem(url, 404, error.message), 404);
  }
  return new HttpException(problem(url, 500, "Events could not be listed"), 500);
}

function problem(instance: string | undefined, status: 400 | 404 | 500, detail: string): ProblemDetails {
  const errorCode = status === 400 ? "EVENT_VALIDATION_FAILED" : status === 404 ? "EVENT_NOT_FOUND" : "EVENT_INTERNAL";
  return {
    type: `https://alter.dev/problems/${errorCode.toLowerCase().replaceAll("_", "-")}`,
    title: status === 400 ? "Bad Request" : status === 404 ? "Not Found" : "Internal Server Error",
    status, detail, instance: instance?.startsWith("/") ? instance : "/", error_code: errorCode,
    trace_id: prefixedUuidV7("trc"), request_id: prefixedUuidV7("req"), retryable: status === 500,
    field_errors: [], documentation_key: "events",
  };
}

function prefixedUuidV7(prefix: "trc" | "req"): `${typeof prefix}_${string}` {
  const id = randomUUID();
  return `${prefix}_${id.slice(0, 14)}7${id.slice(15)}` as `${typeof prefix}_${string}`;
}
