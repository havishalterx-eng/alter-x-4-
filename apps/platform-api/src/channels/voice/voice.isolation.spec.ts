// CONN-ISO: proves a voice number binding cannot be read, mutated, or used
// to place a call from a workspace that doesn't own it. Voice has no
// per-workspace ledger of bindings in platform-api (unlike WhatsApp's
// account list), and the contract originally had no GET-by-id route either
// -- see the accompanying finding. The fix adds GetNumberBinding to the
// contract and gates every by-id operation
// (updateCallHandling/capabilities/health/initiateCall) through
// VoiceService.requireOwnBinding, which re-checks the returned binding's
// workspace_id locally rather than trusting Engine's response blindly.
//
// Uses two REAL, independently provisioned bindings (workspace A's and
// workspace B's), not one binding probed with a swapped workspace header --
// the fake Engine below genuinely scopes list()/get() by workspace, exactly
// like a real per-tenant Engine boundary would.
import { describe, expect, it, vi } from "vitest";
import type { EngineCallerContext, EngineClient } from "../../engine";
import { VoiceService } from "./voice.service";

const bindingIdA = "voc_workspace_a_binding";
const bindingIdB = "voc_workspace_b_binding";
const callHandling = { inbound_calls_enabled: true, voice_style: { language_tag: "en-IN" } };

function binding(id: string, workspaceId: string) {
  return {
    id,
    workspace_id: workspaceId,
    provider: "twilio" as const,
    phone_number: workspaceId === "ws_workspace_a" ? "+15551234567" : "+15559876543",
    status: "active" as const,
    call_handling: callHandling,
    created_at: "2026-08-04T08:00:00Z",
    updated_at: "2026-08-04T08:00:00Z",
  };
}
const bindingA = binding(bindingIdA, "ws_workspace_a");
const bindingB = binding(bindingIdB, "ws_workspace_b");
const bindingsByWorkspace: Record<string, typeof bindingA> = {
  ws_workspace_a: bindingA,
  ws_workspace_b: bindingB,
};

function contextFor(workspaceId: string): EngineCallerContext {
  return {
    userId: "usr_1",
    tenantId: "ten_shared",
    workspaceId,
    sessionId: "session_1",
    authTime: 1,
    roles: ["admin"],
    permissions: ["integrations:read", "integrations:write"],
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
  };
}

// Simulates a real, correctly-scoped Engine: GetNumberBinding and the list
// route both return only the caller's own workspace's binding(s).
class FakeScopedEngineClient {
  readonly patch = vi.fn();
  readonly post = vi.fn();
  readonly get = vi.fn(async (path: string, context: EngineCallerContext) => {
    if (path === "/api/v1/channels/voice/numbers") {
      const own = bindingsByWorkspace[context.workspaceId];
      return { status: 200, body: { data: own ? [own] : [], page: { next_cursor: null, has_more: false, limit: 25 } } };
    }
    const requestedId = path.split("/").pop()!;
    const own = bindingsByWorkspace[context.workspaceId];
    if (own && own.id === requestedId) return { status: 200, body: own };
    // Engine correctly reports "not found" for a binding outside the caller's workspace.
    return { status: 200, body: undefined };
  });
}

describe("Voice cross-workspace isolation (CONN-ISO)", () => {
  it("shows workspace B its own real binding while excluding workspace A's", async () => {
    const engine = new FakeScopedEngineClient();
    const service = new VoiceService(engine as unknown as EngineClient);

    const listB = await service.list({}, contextFor("ws_workspace_b"));
    expect(listB.data).toEqual([expect.objectContaining({ id: bindingIdB })]);
    expect(listB.data.some((b) => b.id === bindingIdA)).toBe(false);

    const listA = await service.list({}, contextFor("ws_workspace_a"));
    expect(listA.data).toEqual([expect.objectContaining({ id: bindingIdA })]);

    await expect(service.requireOwnBinding(bindingIdB, contextFor("ws_workspace_b"))).resolves.toMatchObject({
      id: bindingIdB,
    });
  });

  it("denies workspace B updating call-handling on workspace A's binding, and never calls Engine's patch", async () => {
    const engine = new FakeScopedEngineClient();
    const service = new VoiceService(engine as unknown as EngineClient);
    await expect(
      service.updateCallHandling(
        bindingIdA,
        { call_handling: callHandling },
        contextFor("ws_workspace_b"),
        "idem_1",
        '"etag"',
      ),
    ).rejects.toThrow("Voice number binding not found");
    expect(engine.patch).not.toHaveBeenCalled();
  });

  it("denies workspace B reading capabilities/health for workspace A's binding", async () => {
    const engine = new FakeScopedEngineClient();
    const service = new VoiceService(engine as unknown as EngineClient);
    await expect(service.capabilities(bindingIdA, contextFor("ws_workspace_b"))).rejects.toThrow(
      "Voice number binding not found",
    );
    await expect(service.health(bindingIdA, contextFor("ws_workspace_b"))).rejects.toThrow(
      "Voice number binding not found",
    );
  });

  it("denies workspace B initiating a call against workspace A's binding, and never places the call", async () => {
    const engine = new FakeScopedEngineClient();
    const service = new VoiceService(engine as unknown as EngineClient);
    await expect(
      service.initiateCall(
        { voice_account_id: bindingIdA, to_phone_number: "+15559876543" },
        contextFor("ws_workspace_b"),
        "idem_2",
      ),
    ).rejects.toThrow("Voice number binding not found");
    expect(engine.post).not.toHaveBeenCalled();
  });

  it("still allows workspace A to operate on its own binding", async () => {
    const engine = new FakeScopedEngineClient();
    engine.patch.mockResolvedValue({ status: 200, body: bindingA });
    const service = new VoiceService(engine as unknown as EngineClient);
    await expect(
      service.updateCallHandling(
        bindingIdA,
        { call_handling: callHandling },
        contextFor("ws_workspace_a"),
        "idem_3",
        '"etag"',
      ),
    ).resolves.toMatchObject({ id: bindingIdA });
  });

  it("still denies with a worst-case Engine that hasn't scoped GetNumberBinding, by re-checking workspace_id locally", async () => {
    // Even if Engine's GetNumberBinding route ever regressed and returned a
    // binding regardless of workspace, VoiceService.requireOwnBinding must
    // not trust that response blindly.
    const get = vi.fn().mockResolvedValue({ status: 200, body: bindingA });
    const patch = vi.fn();
    const service = new VoiceService({ get, patch } as unknown as EngineClient);
    await expect(
      service.updateCallHandling(bindingIdA, { call_handling: callHandling }, contextFor("ws_workspace_b"), "idem_4", '"etag"'),
    ).rejects.toThrow("Voice number binding not found");
    expect(patch).not.toHaveBeenCalled();
  });
});
