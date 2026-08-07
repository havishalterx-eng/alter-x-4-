import { describe, expect, it, vi } from "vitest";
import type { EngineClient, EngineCallerContext } from "../../engine";
import { VoiceService } from "./voice.service";

const context: EngineCallerContext = {
  userId: "usr_1",
  tenantId: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspaceId: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  sessionId: "session_1",
  authTime: 1,
  roles: ["admin"],
  permissions: ["integrations:read", "integrations:write"],
  traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
};

const binding = {
  id: "voc_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: context.workspaceId,
  provider: "twilio" as const,
  phone_number: "+15551234567",
  status: "pending" as const,
  call_handling: {
    inbound_calls_enabled: true,
    voice_style: { language_tag: "en-IN" },
  },
  created_at: "2026-08-04T08:00:00Z",
  updated_at: "2026-08-04T08:00:00Z",
};

describe("VoiceService", () => {
  it("binds a number through the authenticated Engine boundary", async () => {
    const post = vi.fn().mockResolvedValue({ status: 201, body: binding });
    const service = new VoiceService({ post } as unknown as EngineClient);
    const input = {
      workspace_id: context.workspaceId,
      provider: "twilio" as const,
      phone_number: "+15551234567",
      credential_reference: "vault://twilio/acct-1",
      call_handling: binding.call_handling,
    };

    await expect(service.bindNumber(input, context, "idem_1")).resolves.toEqual(binding);
    expect(post).toHaveBeenCalledWith(
      "/api/v1/channels/voice/numbers",
      input,
      context,
      { idempotencyKey: "idem_1" },
    );
    expect(JSON.stringify(post.mock.calls)).not.toContain("acct-1-raw-token");
  });

  it("lists number bindings with cursor and limit encoded on the query string", async () => {
    const get = vi.fn().mockResolvedValue({
      status: 200,
      body: { data: [binding], page: { next_cursor: null, has_more: false, limit: 25 } },
    });
    const service = new VoiceService({ get } as unknown as EngineClient);

    await service.list({ cursor: "next/page", limit: 25 }, context);
    expect(get).toHaveBeenCalledWith(
      "/api/v1/channels/voice/numbers?cursor=next%2Fpage&limit=25",
      context,
    );
  });

  it("lists number bindings without a query string when pagination is empty", async () => {
    const get = vi.fn().mockResolvedValue({
      status: 200,
      body: { data: [], page: { next_cursor: null, has_more: false, limit: 25 } },
    });
    const service = new VoiceService({ get } as unknown as EngineClient);

    await service.list({}, context);
    expect(get).toHaveBeenCalledWith("/api/v1/channels/voice/numbers", context);
  });

  describe("requireOwnBinding (CONN-ISO ownership gate)", () => {
    it("returns the binding when Engine confirms it belongs to the caller's workspace", async () => {
      const get = vi.fn().mockResolvedValue({ status: 200, body: binding });
      const service = new VoiceService({ get } as unknown as EngineClient);

      await expect(service.requireOwnBinding(binding.id, context)).resolves.toEqual(binding);
      expect(get).toHaveBeenCalledWith(
        `/api/v1/channels/voice/numbers/${binding.id}`,
        context,
      );
    });

    it("404s when Engine returns no binding", async () => {
      const get = vi.fn().mockResolvedValue({ status: 200, body: undefined });
      const service = new VoiceService({ get } as unknown as EngineClient);

      await expect(service.requireOwnBinding(binding.id, context)).rejects.toThrow(
        "Voice number binding not found",
      );
    });

    it("404s when Engine returns a binding for a different workspace, without trusting the response blindly", async () => {
      const get = vi.fn().mockResolvedValue({
        status: 200,
        body: { ...binding, workspace_id: "ws_someone_elses_workspace" },
      });
      const service = new VoiceService({ get } as unknown as EngineClient);

      await expect(service.requireOwnBinding(binding.id, context)).rejects.toThrow(
        "Voice number binding not found",
      );
    });
  });

  it("updates call handling only after confirming ownership, with the client-supplied If-Match token", async () => {
    const get = vi.fn().mockResolvedValue({ status: 200, body: binding });
    const patch = vi.fn().mockResolvedValue({ status: 200, body: binding });
    const service = new VoiceService({ get, patch } as unknown as EngineClient);
    const input = { call_handling: binding.call_handling };

    await expect(
      service.updateCallHandling(binding.id, input, context, "idem_2", '"etag-1"'),
    ).resolves.toEqual(binding);
    expect(get).toHaveBeenCalledWith(`/api/v1/channels/voice/numbers/${binding.id}`, context);
    expect(patch).toHaveBeenCalledWith(
      `/api/v1/channels/voice/numbers/${binding.id}/call-handling`,
      input,
      context,
      { idempotencyKey: "idem_2", ifMatch: '"etag-1"' },
    );
  });

  it("rejects call-handling updates for a binding owned by a different workspace before ever calling Engine's patch", async () => {
    const get = vi.fn().mockResolvedValue({
      status: 200,
      body: { ...binding, workspace_id: "ws_someone_elses_workspace" },
    });
    const patch = vi.fn();
    const service = new VoiceService({ get, patch } as unknown as EngineClient);

    await expect(
      service.updateCallHandling(binding.id, { call_handling: binding.call_handling }, context, "idem_2", '"etag-1"'),
    ).rejects.toThrow("Voice number binding not found");
    expect(patch).not.toHaveBeenCalled();
  });

  it("relays capabilities and health only after confirming ownership", async () => {
    const capabilities = {
      supports_inbound_calls: true,
      supports_outbound_calls: true,
      supports_status_callbacks: false,
      supported_languages: ["en-IN"],
      supported_voice_styles: ["calm"],
    };
    const health = { status: "healthy" as const, checked_at: "2026-08-04T08:00:00Z", latency_ms: 42 };
    const get = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: binding }) // requireOwnBinding for capabilities()
      .mockResolvedValueOnce({ status: 200, body: capabilities })
      .mockResolvedValueOnce({ status: 200, body: binding }) // requireOwnBinding for health()
      .mockResolvedValueOnce({ status: 200, body: health });
    const service = new VoiceService({ get } as unknown as EngineClient);

    await expect(service.capabilities(binding.id, context)).resolves.toEqual(capabilities);
    await expect(service.health(binding.id, context)).resolves.toEqual(health);
    expect(get).toHaveBeenNthCalledWith(1, `/api/v1/channels/voice/numbers/${binding.id}`, context);
    expect(get).toHaveBeenNthCalledWith(
      2,
      `/api/v1/channels/voice/numbers/${binding.id}/capabilities`,
      context,
    );
    expect(get).toHaveBeenNthCalledWith(3, `/api/v1/channels/voice/numbers/${binding.id}`, context);
    expect(get).toHaveBeenNthCalledWith(
      4,
      `/api/v1/channels/voice/numbers/${binding.id}/health`,
      context,
    );
  });

  it("rejects capabilities and health reads for a binding owned by a different workspace", async () => {
    const foreign = { status: 200, body: { ...binding, workspace_id: "ws_someone_elses_workspace" } };
    const get = vi.fn().mockResolvedValue(foreign);
    const service = new VoiceService({ get } as unknown as EngineClient);

    await expect(service.capabilities(binding.id, context)).rejects.toThrow("Voice number binding not found");
    await expect(service.health(binding.id, context)).rejects.toThrow("Voice number binding not found");
    // Only the ownership-check GET fired -- the actual capabilities/health GET never happened.
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Engine returns an empty body for any typed route", async () => {
    const empty = { status: 200, body: undefined };
    const post = vi.fn().mockResolvedValue(empty);
    const get = vi.fn().mockResolvedValue(empty);
    const service = new VoiceService({ post, get } as unknown as EngineClient);
    const input = {
      workspace_id: context.workspaceId,
      provider: "twilio" as const,
      phone_number: "+15551234567",
      credential_reference: "vault://twilio/acct-1",
      call_handling: binding.call_handling,
    };

    await expect(service.bindNumber(input, context, "idem_1")).rejects.toThrow(
      "Engine returned an empty voice number binding response",
    );
    await expect(service.list({}, context)).rejects.toThrow(
      "Engine returned an empty voice number binding list",
    );
    // Ownership check itself fails closed (empty body => not found) before
    // any of these routes reach their own "empty response" branch.
    await expect(
      service.updateCallHandling(binding.id, { call_handling: binding.call_handling }, context, "idem_2", '"etag-1"'),
    ).rejects.toThrow("Voice number binding not found");
    await expect(service.capabilities(binding.id, context)).rejects.toThrow("Voice number binding not found");
    await expect(service.health(binding.id, context)).rejects.toThrow("Voice number binding not found");
  });

  it("fails closed when ownership checks out but the route's own Engine call returns an empty body", async () => {
    const okThenEmpty = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: binding }) // requireOwnBinding
      .mockResolvedValueOnce({ status: 200, body: undefined }); // the route's own call
    const emptyPatch = { status: 200, body: undefined };

    const capabilitiesService = new VoiceService({ get: okThenEmpty } as unknown as EngineClient);
    await expect(capabilitiesService.capabilities(binding.id, context)).rejects.toThrow(
      "Engine returned an empty voice capabilities response",
    );

    const healthService = new VoiceService({
      get: vi.fn()
        .mockResolvedValueOnce({ status: 200, body: binding })
        .mockResolvedValueOnce({ status: 200, body: undefined }),
    } as unknown as EngineClient);
    await expect(healthService.health(binding.id, context)).rejects.toThrow(
      "Engine returned an empty voice account health response",
    );

    const handlingService = new VoiceService({
      get: vi.fn().mockResolvedValueOnce({ status: 200, body: binding }),
      patch: vi.fn().mockResolvedValueOnce(emptyPatch),
    } as unknown as EngineClient);
    await expect(
      handlingService.updateCallHandling(binding.id, { call_handling: binding.call_handling }, context, "idem_9", '"etag-9"'),
    ).rejects.toThrow("Engine returned an empty voice number binding response");
  });

  it("relays initiate-call response opaquely without shaping it as a VoiceCall, only after confirming ownership", async () => {
    const engineBody = { provider_call_reference: "CA123", status: "queued" };
    const get = vi.fn().mockResolvedValue({ status: 200, body: binding });
    const post = vi.fn().mockResolvedValue({ status: 202, body: engineBody });
    const service = new VoiceService({ get, post } as unknown as EngineClient);
    const input = { voice_account_id: binding.id, to_phone_number: "+15559876543" };

    await expect(service.initiateCall(input, context, "idem_3")).resolves.toEqual(engineBody);
    expect(get).toHaveBeenCalledWith(`/api/v1/channels/voice/numbers/${binding.id}`, context);
    expect(post).toHaveBeenCalledWith(
      "/api/v1/channels/voice/calls",
      input,
      context,
      { idempotencyKey: "idem_3" },
    );
  });

  it("rejects initiating a call against a binding owned by a different workspace, and never places the call", async () => {
    const get = vi.fn().mockResolvedValue({
      status: 200,
      body: { ...binding, workspace_id: "ws_someone_elses_workspace" },
    });
    const post = vi.fn();
    const service = new VoiceService({ get, post } as unknown as EngineClient);
    const input = { voice_account_id: binding.id, to_phone_number: "+15559876543" };

    await expect(service.initiateCall(input, context, "idem_3")).rejects.toThrow(
      "Voice number binding not found",
    );
    expect(post).not.toHaveBeenCalled();
  });
});
