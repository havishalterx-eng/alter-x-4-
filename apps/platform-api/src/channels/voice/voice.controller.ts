import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseFilters,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Idempotent } from "../../idempotency";
import { ActorContext, RequirePermission, RequireWorkspaceRole, type ActorContextType } from "../../rbac";
import type { EngineCallerContext } from "../../engine";
import { VoiceService } from "./voice.service";
import { VoiceExceptionFilter } from "./voice-exception.filter";
import {
  parseCreateVoiceNumberBinding,
  parseInitiateVoiceCall,
  parseUpdateVoiceCallHandling,
  parseVoiceAccountId,
  parseVoicePagination,
  requireIfMatch,
} from "./validation";

const readRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;
const writeRoles = ["admin", "editor"] as const;

@Controller("/api/v1/channels/voice")
@UseFilters(VoiceExceptionFilter)
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Post("numbers") @HttpCode(201) @RequireWorkspaceRole(...writeRoles) @RequirePermission("integrations:write") @Idempotent()
  bindNumber(
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    const instance = "/api/v1/channels/voice/numbers";
    return this.voice.bindNumber(
      parseCreateVoiceNumberBinding(body, instance),
      context(requireActor(actor), traceparent),
      idempotencyKey!,
    );
  }

  @Get("numbers") @RequireWorkspaceRole(...readRoles) @RequirePermission("integrations:read")
  list(
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
  ) {
    const instance = "/api/v1/channels/voice/numbers";
    return this.voice.list(
      parseVoicePagination(cursor, limit, instance),
      context(requireActor(actor), traceparent),
    );
  }

  @Get("numbers/:id") @RequireWorkspaceRole(...readRoles) @RequirePermission("integrations:read")
  getBinding(
    @Param("id") id: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
  ) {
    const instance = `/api/v1/channels/voice/numbers/${id}`;
    return this.voice.requireOwnBinding(
      parseVoiceAccountId(id, instance),
      context(requireActor(actor), traceparent),
    );
  }

  @Patch("numbers/:id/call-handling") @RequireWorkspaceRole(...writeRoles) @RequirePermission("integrations:write") @Idempotent()
  updateCallHandling(
    @Param("id") id: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
  ) {
    const instance = `/api/v1/channels/voice/numbers/${id}/call-handling`;
    return this.voice.updateCallHandling(
      parseVoiceAccountId(id, instance),
      parseUpdateVoiceCallHandling(body, instance),
      context(requireActor(actor), traceparent),
      idempotencyKey!,
      requireIfMatch(ifMatch, instance),
    );
  }

  @Get("numbers/:id/capabilities") @RequireWorkspaceRole(...readRoles) @RequirePermission("integrations:read")
  capabilities(
    @Param("id") id: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
  ) {
    const instance = `/api/v1/channels/voice/numbers/${id}/capabilities`;
    return this.voice.capabilities(
      parseVoiceAccountId(id, instance),
      context(requireActor(actor), traceparent),
    );
  }

  @Get("numbers/:id/health") @RequireWorkspaceRole(...readRoles) @RequirePermission("integrations:read")
  health(
    @Param("id") id: string,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
  ) {
    const instance = `/api/v1/channels/voice/numbers/${id}/health`;
    return this.voice.health(
      parseVoiceAccountId(id, instance),
      context(requireActor(actor), traceparent),
    );
  }

  @Post("calls") @HttpCode(202) @RequireWorkspaceRole(...writeRoles) @RequirePermission("integrations:write") @Idempotent()
  initiateCall(
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    const instance = "/api/v1/channels/voice/calls";
    return this.voice.initiateCall(
      parseInitiateVoiceCall(body, instance),
      context(requireActor(actor), traceparent),
      idempotencyKey!,
    );
  }
}

function requireActor(actor: ActorContextType | undefined): ActorContextType {
  if (!actor) throw new UnauthorizedException("Authenticated actor required");
  return actor;
}

function context(actor: ActorContextType, traceparent: string | undefined): EngineCallerContext {
  if (!actor.workspace_id) throw new UnauthorizedException("Workspace actor context required");
  return {
    userId: actor.user_id,
    tenantId: actor.tenant_id,
    workspaceId: actor.workspace_id,
    sessionId: actor.session_id,
    authTime: actor.auth_time ?? Math.floor(Date.now() / 1_000),
    roles: actor.roles,
    permissions: actor.permissions,
    traceparent: traceparent ?? `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`,
  };
}
