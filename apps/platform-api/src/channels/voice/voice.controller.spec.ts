import { describe, expect, it, vi } from "vitest";
import type { ActorContextType } from "../../rbac";
import type { VoiceService } from "./voice.service";
import { VoiceController } from "./voice.controller";
import { VoiceModule } from "./voice.module";
import { voiceDeferredCapabilities } from "./types";

const actor: ActorContextType = {
  user_id: "usr_1",
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session_1",
  auth_time: 1,
  roles: ["admin"],
  permissions: ["integrations:read", "integrations:write"],
};

const bindingId = "voc_018f47a5-7b2c-7d10-8f11-123456789abc";
const callHandling = { inbound_calls_enabled: true, voice_style: { language_tag: "en-IN" } };
const binding = {
  id: bindingId,
  workspace_id: actor.workspace_id,
  provider: "twilio" as const,
  phone_number: "+15551234567",
  status: "pending" as const,
  call_handling: callHandling,
  created_at: "2026-08-04T08:00:00Z",
  updated_at: "2026-08-04T08:00:00Z",
};

describe("VoiceController", () => {
  it("wires the production module and documents every live-verification NOT_MET flag", () => {
    expect(VoiceModule).toBeDefined();
    expect(voiceDeferredCapabilities.map((c) => c.capability)).toEqual([
      "voice_provider_round_trip",
      "voice_call_initiate_response_shape",
    ]);
    expect(voiceDeferredCapabilities.every((c) => c.status === "NOT_MET")).toBe(true);
  });


  it("routes all actions through the service with parsed input and actor context", async () => {
    const service = {
      bindNumber: vi.fn().mockResolvedValue(binding),
      list: vi.fn().mockResolvedValue({ data: [binding], page: { next_cursor: null, has_more: false, limit: 25 } }),
      requireOwnBinding: vi.fn().mockResolvedValue(binding),
      updateCallHandling: vi.fn().mockResolvedValue(binding),
      capabilities: vi.fn().mockResolvedValue({
        supports_inbound_calls: true,
        supports_outbound_calls: true,
        supports_status_callbacks: false,
        supported_languages: ["en-IN"],
        supported_voice_styles: ["calm"],
      }),
      health: vi.fn().mockResolvedValue({ status: "healthy", checked_at: "2026-08-04T08:00:00Z", latency_ms: 12 }),
      initiateCall: vi.fn().mockResolvedValue({ provider_call_reference: "CA123", status: "queued" }),
    } as unknown as VoiceService;
    const controller = new VoiceController(service);

    const createInput = {
      workspace_id: actor.workspace_id,
      provider: "twilio" as const,
      phone_number: "+15551234567",
      credential_reference: "vault://twilio/acct-1",
      call_handling: callHandling,
    };
    await expect(controller.bindNumber(createInput, actor, undefined, "idem_1")).resolves.toEqual(binding);
    await expect(controller.list(undefined, undefined, actor, undefined)).resolves.toEqual({
      data: [binding],
      page: { next_cursor: null, has_more: false, limit: 25 },
    });
    await expect(controller.getBinding(bindingId, actor, undefined)).resolves.toEqual(binding);
    await expect(
      controller.updateCallHandling(bindingId, { call_handling: callHandling }, actor, undefined, "idem_2", '"etag-1"'),
    ).resolves.toEqual(binding);
    await expect(controller.capabilities(bindingId, actor, undefined)).resolves.toMatchObject({
      supports_inbound_calls: true,
    });
    await expect(controller.health(bindingId, actor, undefined)).resolves.toMatchObject({ status: "healthy" });
    await expect(
      controller.initiateCall(
        { voice_account_id: bindingId, to_phone_number: "+15559876543" },
        actor,
        undefined,
        "idem_3",
      ),
    ).resolves.toEqual({ provider_call_reference: "CA123", status: "queued" });

    expect(service.updateCallHandling).toHaveBeenCalledWith(
      bindingId,
      { call_handling: callHandling },
      expect.objectContaining({ workspaceId: actor.workspace_id }),
      "idem_2",
      '"etag-1"',
    );
  });

  it("rejects a missing authenticated actor or workspace", () => {
    const controller = new VoiceController({} as VoiceService);
    const tenantOnlyActor: ActorContextType = {
      user_id: actor.user_id,
      tenant_id: actor.tenant_id,
      session_id: actor.session_id,
      auth_time: 1,
      roles: actor.roles,
      permissions: actor.permissions,
    };
    expect(() => controller.list(undefined, undefined, undefined, undefined)).toThrow("Authenticated actor required");
    expect(() => controller.list(undefined, undefined, tenantOnlyActor, undefined)).toThrow(
      "Workspace actor context required",
    );
  });

  it("rejects a call-handling update missing the If-Match header before touching the service", () => {
    const service = { updateCallHandling: vi.fn() } as unknown as VoiceService;
    const controller = new VoiceController(service);
    try {
      controller.updateCallHandling(bindingId, { call_handling: callHandling }, actor, undefined, "idem_2", undefined);
      expect.unreachable();
    } catch (error) {
      expect((error as { getStatus(): number }).getStatus()).toBe(428);
      expect((error as { getResponse(): unknown }).getResponse()).toMatchObject({ error_code: "IF_MATCH_REQUIRED" });
    }
    expect(service.updateCallHandling).not.toHaveBeenCalled();
  });

  it("rejects an invalid create-binding body before touching the service", () => {
    const service = { bindNumber: vi.fn() } as unknown as VoiceService;
    const controller = new VoiceController(service);
    try {
      controller.bindNumber({ phone_number: "not-e164" }, actor, undefined, "idem_1");
      expect.unreachable();
    } catch (error) {
      expect((error as { getStatus(): number }).getStatus()).toBe(400);
      expect((error as { getResponse(): unknown }).getResponse()).toMatchObject({
        error_code: "VOICE_VALIDATION_FAILED",
      });
    }
    expect(service.bindNumber).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range pagination limit before touching the service", () => {
    const service = { list: vi.fn() } as unknown as VoiceService;
    const controller = new VoiceController(service);
    try {
      controller.list(undefined, "0", actor, undefined);
      expect.unreachable();
    } catch (error) {
      expect((error as { getStatus(): number }).getStatus()).toBe(400);
      expect((error as { getResponse(): unknown }).getResponse()).toMatchObject({
        error_code: "VOICE_VALIDATION_FAILED",
      });
    }
    expect(service.list).not.toHaveBeenCalled();
  });

  it("rejects a malformed voice account id before touching the service", () => {
    const service = { health: vi.fn(), requireOwnBinding: vi.fn() } as unknown as VoiceService;
    const controller = new VoiceController(service);
    try {
      controller.health("not-an-id", actor, undefined);
      expect.unreachable();
    } catch (error) {
      expect((error as { getStatus(): number }).getStatus()).toBe(400);
      expect((error as { getResponse(): unknown }).getResponse()).toMatchObject({
        error_code: "VOICE_VALIDATION_FAILED",
      });
    }
    expect(service.health).not.toHaveBeenCalled();

    try {
      controller.getBinding("not-an-id", actor, undefined);
      expect.unreachable();
    } catch (error) {
      expect((error as { getStatus(): number }).getStatus()).toBe(400);
    }
    expect(service.requireOwnBinding).not.toHaveBeenCalled();
  });
});
