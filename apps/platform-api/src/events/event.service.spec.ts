import { describe, expect, it, vi } from "vitest";
import type {
  EngineCallerContext,
  EngineClient,
  EnginePath,
  EngineResponse,
} from "../engine";
import type { ActorContext } from "../rbac/types";
import { EventService } from "./event.service";
import type { EnginePage, EngineResource } from "./types";

const eventId = "evt_018f47a5-7b2c-7d10-8f11-123456789abc";
const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
const actor: ActorContext = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session-a",
  auth_time: 1_700_000_000,
  roles: ["viewer"],
  permissions: ["runs:read"],
};

describe("EventService", () => {
  it("relays real list filters, pagination, and opaque rows", async () => {
    const response = page([
      { event_id: eventId, source: "whatsapp", signature_status: "verified" },
    ]);
    const engine = engineStub(async () => ({ status: 200, body: response }));
    const service = new EventService(engine.value);

    const result = await service.list(
      { cursor: "next cursor", limit: "25", source: "whatsapp", status: "triggered" },
      actor,
      traceparent,
    );

    expect(engine.get).toHaveBeenCalledWith(
      "/api/v1/events?cursor=next+cursor&limit=25&source=whatsapp&status=triggered",
      expectedContext(),
    );
    expect(result.body).toEqual(response);
  });

  it("passes a single event through unchanged", async () => {
    const event = { event_id: eventId, source: "whatsapp", signature_status: "verified" };
    const engine = engineStub(async () => ({ status: 200, body: event }));
    const service = new EventService(engine.value);

    const result = await service.get(eventId, actor, traceparent);

    expect(engine.get).toHaveBeenCalledWith(`/api/v1/events/${eventId}`, expectedContext());
    expect(result.body).toEqual(event);
  });

  it("rejects invented filters, non-derivable status, invalid ids, and trace context", async () => {
    const engine = engineStub(async () => ({ status: 200, body: page([]) }));
    const service = new EventService(engine.value);

    expect(() =>
      service.list({ status: "matched" } as never, actor, traceparent),
    ).toThrow(expect.objectContaining({ status: 400 }));
    expect(() =>
      service.list({ workflow_id: "wf_x" } as never, actor, traceparent),
    ).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => service.get("bad", actor, traceparent)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => service.list({}, actor, "bad-trace")).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(engine.get).not.toHaveBeenCalled();
  });

  it("requires workspace context and generates missing trace context", async () => {
    const engine = engineStub(async () => ({ status: 200, body: page([]) }));
    const service = new EventService(engine.value);
    const { workspace_id: _workspace, ...withoutWorkspace } = actor;
    void _workspace;

    expect(() => service.list({}, withoutWorkspace, traceparent)).toThrow(
      expect.objectContaining({
        status: 403,
        response: expect.objectContaining({ error_code: "EVENT_WORKSPACE_REQUIRED" }),
      }),
    );

    await service.list({}, actor, undefined);
    expect(engine.get).toHaveBeenCalledWith(
      "/api/v1/events",
      expect.objectContaining({
        traceparent: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/),
      }),
    );
  });
});

function expectedContext(): EngineCallerContext {
  return {
    userId: actor.user_id,
    tenantId: actor.tenant_id,
    workspaceId: actor.workspace_id!,
    sessionId: actor.session_id,
    authTime: actor.auth_time!,
    roles: actor.roles,
    permissions: actor.permissions,
    traceparent,
  };
}

function page(data: readonly EngineResource[]): EnginePage<EngineResource> {
  return {
    data,
    page: { next_cursor: null, has_more: false, limit: 50 },
  };
}

function engineStub(
  implementation: (
    path: EnginePath,
    context: EngineCallerContext,
  ) => Promise<EngineResponse<EngineResource | EnginePage<EngineResource>>>,
): { value: EngineClient; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(implementation);
  return { value: { get } as unknown as EngineClient, get };
}
