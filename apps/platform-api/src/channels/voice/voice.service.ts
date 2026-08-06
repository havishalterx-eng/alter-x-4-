import { Injectable, NotFoundException } from "@nestjs/common";
import type { JsonValue } from "@alterx/shared-clients";
import { EngineClient, type EngineCallerContext } from "../../engine";
import type {
  CreateVoiceNumberBindingRequest,
  InitiateVoiceCallRequest,
  UpdateVoiceCallHandlingRequest,
  VoiceAccountHealth,
  VoiceCapabilities,
  VoiceNumberBinding,
  VoiceNumberBindingList,
  VoicePagination,
} from "./types";

@Injectable()
export class VoiceService {
  constructor(private readonly engine: EngineClient) {}

  async bindNumber(
    input: CreateVoiceNumberBindingRequest,
    context: EngineCallerContext,
    idempotencyKey: string,
  ): Promise<VoiceNumberBinding> {
    const response = await this.engine.post<JsonValue, VoiceNumberBinding>(
      "/api/v1/channels/voice/numbers",
      input as unknown as JsonValue,
      context,
      { idempotencyKey },
    );
    if (!response.body) {
      throw new Error("Engine returned an empty voice number binding response");
    }
    return response.body;
  }

  async list(
    pagination: VoicePagination,
    context: EngineCallerContext,
  ): Promise<VoiceNumberBindingList> {
    const query = new URLSearchParams();
    if (pagination.cursor) query.set("cursor", pagination.cursor);
    if (pagination.limit !== undefined) query.set("limit", String(pagination.limit));
    const suffix = query.toString();
    const response = await this.engine.get<VoiceNumberBindingList>(
      `/api/v1/channels/voice/numbers${suffix ? `?${suffix}` : ""}`,
      context,
    );
    if (!response.body) {
      throw new Error("Engine returned an empty voice number binding list");
    }
    return response.body;
  }

  // Confirms voiceAccountId belongs to the caller's own tenant/workspace
  // before any by-id operation touches it. There is no per-workspace ledger
  // of bindings in platform-api (unlike WhatsApp's account list), so this is
  // the only local check available -- see CONN-ISO. Engine is asked with the
  // caller's own tenantId/workspaceId, and the returned binding's
  // workspace_id is re-checked locally rather than trusted blindly, so a
  // misbehaving Engine response can't leak a cross-workspace binding through
  // this path either.
  async requireOwnBinding(
    voiceAccountId: string,
    context: EngineCallerContext,
  ): Promise<VoiceNumberBinding> {
    const response = await this.engine.get<VoiceNumberBinding>(
      `/api/v1/channels/voice/numbers/${encodeURIComponent(voiceAccountId)}`,
      context,
    );
    if (!response.body || response.body.workspace_id !== context.workspaceId) {
      throw new NotFoundException("Voice number binding not found");
    }
    return response.body;
  }

  async updateCallHandling(
    voiceAccountId: string,
    input: UpdateVoiceCallHandlingRequest,
    context: EngineCallerContext,
    idempotencyKey: string,
    ifMatch: string,
  ): Promise<VoiceNumberBinding> {
    await this.requireOwnBinding(voiceAccountId, context);
    const response = await this.engine.patch<JsonValue, VoiceNumberBinding>(
      `/api/v1/channels/voice/numbers/${encodeURIComponent(voiceAccountId)}/call-handling`,
      input as unknown as JsonValue,
      context,
      { idempotencyKey, ifMatch },
    );
    if (!response.body) {
      throw new Error("Engine returned an empty voice number binding response");
    }
    return response.body;
  }

  async capabilities(
    voiceAccountId: string,
    context: EngineCallerContext,
  ): Promise<VoiceCapabilities> {
    await this.requireOwnBinding(voiceAccountId, context);
    const response = await this.engine.get<VoiceCapabilities>(
      `/api/v1/channels/voice/numbers/${encodeURIComponent(voiceAccountId)}/capabilities`,
      context,
    );
    if (!response.body) {
      throw new Error("Engine returned an empty voice capabilities response");
    }
    return response.body;
  }

  async health(
    voiceAccountId: string,
    context: EngineCallerContext,
  ): Promise<VoiceAccountHealth> {
    await this.requireOwnBinding(voiceAccountId, context);
    const response = await this.engine.get<VoiceAccountHealth>(
      `/api/v1/channels/voice/numbers/${encodeURIComponent(voiceAccountId)}/health`,
      context,
    );
    if (!response.body) {
      throw new Error("Engine returned an empty voice account health response");
    }
    return response.body;
  }

  // Deliberately untyped: see voiceDeferredCapabilities in ./types for why this
  // route's response is relayed opaquely instead of parsed as VoiceCall.
  async initiateCall(
    input: InitiateVoiceCallRequest,
    context: EngineCallerContext,
    idempotencyKey: string,
  ): Promise<unknown> {
    await this.requireOwnBinding(input.voice_account_id, context);
    const response = await this.engine.post<JsonValue, unknown>(
      "/api/v1/channels/voice/calls",
      input as unknown as JsonValue,
      context,
      { idempotencyKey },
    );
    return response.body;
  }
}
