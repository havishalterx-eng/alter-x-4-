import type { EngineClient, EngineResponse } from "../engine";
import type { ActorContext } from "../rbac/types";
import { describe, expect, it, vi } from "vitest";
import { ProjectService } from "./project.service";

const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const clarificationId = "clr_018f47a5-7b2c-7d10-8f11-123456789abc";
const traceparent =
  "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
const actor: ActorContext = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session-a",
  auth_time: 1_700_000_000,
  roles: ["editor"],
  permissions: ["projects:write"],
};

describe("ProjectService", () => {
  it("relays brief with exact caller and idempotency context", async () => {
    const engine = engineStub();
    const service = new ProjectService(engine.value);

    await service.create(
      { brief: "Build an invoice platform" },
      actor,
      traceparent,
      "brief-key",
    );

    expect(engine.post).toHaveBeenCalledWith(
      "/api/v1/projects",
      { brief: "Build an invoice platform" },
      {
        userId: actor.user_id,
        tenantId: actor.tenant_id,
        workspaceId: actor.workspace_id,
        sessionId: actor.session_id,
        authTime: actor.auth_time,
        roles: actor.roles,
        permissions: actor.permissions,
        traceparent,
      },
      { idempotencyKey: "brief-key" },
    );
  });

  it("relays pending clarification read and answer", async () => {
    const engine = engineStub();
    const service = new ProjectService(engine.value);

    await service.clarifications(projectId, actor, undefined);
    await service.answerClarification(
      projectId,
      clarificationId,
      { answer: "Use PostgreSQL" },
      actor,
      traceparent,
      "answer-key",
    );

    expect(engine.get).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/clarifications?status=pending`,
      expect.objectContaining({
        traceparent: expect.stringMatching(
          /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
        ),
      }),
    );
    expect(engine.post).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/clarifications/${clarificationId}/answer`,
      { answer: "Use PostgreSQL" },
      expect.objectContaining({ traceparent }),
      { idempotencyKey: "answer-key" },
    );
  });

  it("relays plan read and every review action", async () => {
    const engine = engineStub();
    const service = new ProjectService(engine.value);

    await service.plan(projectId, actor, traceparent);
    await service.reviewPlan(
      projectId,
      "approve",
      {},
      actor,
      traceparent,
      "approve-key",
    );
    await service.reviewPlan(
      projectId,
      "reject",
      { reason: "Missing rollback" },
      actor,
      traceparent,
      "reject-key",
    );
    await service.reviewPlan(
      projectId,
      "request-changes",
      { changes: "Add observability" },
      actor,
      traceparent,
      "changes-key",
    );

    expect(engine.get).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/plan`,
      expect.objectContaining({ workspaceId: actor.workspace_id }),
    );
    expect(engine.post).toHaveBeenNthCalledWith(
      1,
      `/api/v1/projects/${projectId}/plan/actions/approve`,
      {},
      expect.any(Object),
      { idempotencyKey: "approve-key" },
    );
    expect(engine.post).toHaveBeenNthCalledWith(
      2,
      `/api/v1/projects/${projectId}/plan/actions/reject`,
      { reason: "Missing rollback" },
      expect.any(Object),
      { idempotencyKey: "reject-key" },
    );
    expect(engine.post).toHaveBeenNthCalledWith(
      3,
      `/api/v1/projects/${projectId}/plan/actions/request-changes`,
      { changes: "Add observability" },
      expect.any(Object),
      { idempotencyKey: "changes-key" },
    );
  });

  it("starts build once through Engine with generated auth time", async () => {
    const engine = engineStub();
    const service = new ProjectService(engine.value);
    const actorWithoutAuthTime = { ...actor };
    delete actorWithoutAuthTime.auth_time;

    await service.startBuild(
      projectId,
      {},
      actorWithoutAuthTime,
      traceparent,
      "build-key",
    );

    expect(engine.post).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/builds`,
      {},
      expect.objectContaining({
        authTime: expect.any(Number),
        tenantId: actor.tenant_id,
        userId: actor.user_id,
      }),
      { idempotencyKey: "build-key" },
    );
  });

  it("rejects missing workspace before Engine call", async () => {
    const engine = engineStub();
    const service = new ProjectService(engine.value);
    const actorWithoutWorkspace = { ...actor };
    delete actorWithoutWorkspace.workspace_id;

    expect(() =>
      service.create(
        { brief: "Build" },
        actorWithoutWorkspace,
        traceparent,
        "key",
      ),
    ).toThrowError(expect.objectContaining({
      status: 403,
      response: expect.objectContaining({
        error_code: "PROJECT_WORKSPACE_REQUIRED",
      }),
    }));
    expect(engine.post).not.toHaveBeenCalled();
  });

  it.each([
    ["clarifications", "bad-project"],
    ["plan", "bad-project"],
    ["build", "bad-project"],
  ] as const)("rejects invalid project id for %s", async (operation, id) => {
    const engine = engineStub();
    const service = new ProjectService(engine.value);
    const call = () =>
      operation === "clarifications"
        ? service.clarifications(id, actor, traceparent)
        : operation === "plan"
          ? service.plan(id, actor, traceparent)
          : service.startBuild(id, {}, actor, traceparent, "key");

    expect(call).toThrowError(expect.objectContaining({
      status: 400,
      response: expect.objectContaining({
        error_code: "PROJECT_VALIDATION_FAILED",
      }),
    }));
  });

  it("rejects invalid clarification id", async () => {
    const engine = engineStub();
    expect(() =>
      new ProjectService(engine.value).answerClarification(
        projectId,
        "bad",
        { answer: "answer" },
        actor,
        traceparent,
        "key",
      ),
    ).toThrowError(expect.objectContaining({
      status: 400,
      response: expect.objectContaining({
        field_errors: [
          { field: "clarificationId", message: "Invalid clarificationId" },
        ],
      }),
    }));
    expect(engine.post).not.toHaveBeenCalled();
  });
});

function engineStub(): {
  value: EngineClient;
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
} {
  const response: EngineResponse<Record<string, never>> = {
    status: 200,
    body: {},
  };
  const get = vi.fn().mockResolvedValue(response);
  const post = vi.fn().mockResolvedValue(response);
  return {
    value: { get, post } as unknown as EngineClient,
    get,
    post,
  };
}
