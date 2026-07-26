import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { EngineResponse } from "../engine";
import { Idempotent } from "../idempotency";
import {
  ActorContext,
  RequirePermission,
  RequireWorkspaceRole,
} from "../rbac";
import type { ActorContextType } from "../rbac";
import { AdsExceptionFilter } from "./ads-exception.filter";
import { AdsService } from "./ads.service";
import { AdsHttpError } from "./problem";
import type { AdsPage, AdsResource } from "./types";
import { parseAdsInput, parseAdsPagination } from "./validation";

const readRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;
const adminRoles = ["admin", "editor"] as const;
const deleteRoles = ["admin"] as const;

@Controller("/api/v1/ads")
@UseFilters(AdsExceptionFilter)
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Post("sources")
  @RequireWorkspaceRole(...adminRoles)
  @RequirePermission("knowledge:admin")
  @Idempotent()
  async createSource(
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdsResource> {
    const instance = "/api/v1/ads/sources";
    return project(
      await this.ads.createSource(
        parseAdsInput(body, instance),
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }

  @Post("sources/:sourceId/actions/sync")
  @HttpCode(202)
  @RequireWorkspaceRole(...adminRoles)
  @RequirePermission("knowledge:admin")
  @Idempotent()
  async syncSource(
    @Param("sourceId") sourceId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdsResource> {
    const instance = `/api/v1/ads/sources/${sourceId}/actions/sync`;
    return project(
      await this.ads.syncSource(
        sourceId,
        parseAdsInput(body, instance),
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }

  @Post("ingestion/uploads")
  @HttpCode(202)
  @RequireWorkspaceRole(...adminRoles)
  @RequirePermission("knowledge:admin")
  @Idempotent()
  async createUpload(
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdsResource> {
    const instance = "/api/v1/ads/ingestion/uploads";
    return project(
      await this.ads.createUpload(
        parseAdsInput(body, instance),
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }

  @Get("ingestion/jobs/:jobId")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("knowledge:read")
  async ingestionJob(
    @Param("jobId") jobId: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdsResource> {
    const instance = `/api/v1/ads/ingestion/jobs/${jobId}`;
    return project(
      await this.ads.ingestionJob(
        jobId,
        requireActor(actor, instance),
        traceparent,
      ),
      reply,
    );
  }

  @Get("documents")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("knowledge:read")
  async documents(
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdsPage> {
    const instance = "/api/v1/ads/documents";
    return project(
      await this.ads.documents(
        parseAdsPagination(cursor, limit, instance),
        requireActor(actor, instance),
        traceparent,
      ),
      reply,
    );
  }

  @Get("documents/:documentId")
  @RequireWorkspaceRole(...readRoles)
  @RequirePermission("knowledge:read")
  async document(
    @Param("documentId") documentId: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdsResource> {
    const instance = `/api/v1/ads/documents/${documentId}`;
    return project(
      await this.ads.document(
        documentId,
        requireActor(actor, instance),
        traceparent,
      ),
      reply,
    );
  }

  @Delete("documents/:documentId")
  @RequireWorkspaceRole(...deleteRoles)
  @RequirePermission("knowledge:delete")
  @Idempotent()
  async deleteDocument(
    @Param("documentId") documentId: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdsResource> {
    const instance = `/api/v1/ads/documents/${documentId}`;
    return project(
      await this.ads.deleteDocument(
        documentId,
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }

  @Post("knowledge")
  @RequireWorkspaceRole(...adminRoles)
  @RequirePermission("knowledge:admin")
  @Idempotent()
  async createKnowledge(
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdsResource> {
    const instance = "/api/v1/ads/knowledge";
    return project(
      await this.ads.createKnowledge(
        parseAdsInput(body, instance),
        requireActor(actor, instance),
        traceparent,
        idempotencyKey!,
      ),
      reply,
    );
  }
}

function requireActor(
  actor: ActorContextType | undefined,
  instance: string,
): ActorContextType {
  if (!actor) {
    throw new AdsHttpError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authenticated actor required",
      instance,
    );
  }
  return actor;
}

function project<T>(response: EngineResponse<T>, reply: FastifyReply): T {
  reply.status(response.status);
  if (response.location) reply.header("Location", response.location);
  if (response.requestId) reply.header("request_id", response.requestId);
  if (response.traceId) reply.header("trace_id", response.traceId);
  return response.body;
}
