import type { EngineClient, EngineResponse } from "../engine";
import type { ActorContext } from "../rbac/types";
import { describe, expect, it, vi } from "vitest";
import { ProjectOperationsService } from "./project-operations.service";

const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const deploymentId = "dep_018f47a5-7b2c-7d10-8f11-123456789abc";
const conversationId = "cnv_018f47a5-7b2c-7d10-8f11-123456789abc";
const traceparent =
  "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
const actor: ActorContext = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session-a",
  auth_time: 1_700_000_000,
  roles: ["operator"],
  permissions: ["projects:read", "projects:deploy"],
};

describe("ProjectOperationsService", () => {
  it("relays repository with exact caller context", async () => {
    const engine = engineStub();
    await new ProjectOperationsService(engine.value).repository(
      projectId,
      actor,
      traceparent,
    );

    expect(engine.get).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/repository`,
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
    );
  });

  it.each([
    "audit-results",
    "builds",
    "deployments",
    "previews",
    "tests",
    "versions",
  ] as const)("relays paginated %s view", async (collection) => {
    const engine = engineStub();
    await new ProjectOperationsService(engine.value).collection(
      projectId,
      collection,
      { cursor: "next page", limit: 25 },
      actor,
      traceparent,
    );

    expect(engine.get).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/${collection}?cursor=next+page&limit=25`,
      expect.objectContaining({ tenantId: actor.tenant_id }),
    );
  });

  it("does not add absent pagination values", async () => {
    const engine = engineStub();
    await new ProjectOperationsService(engine.value).collection(
      projectId,
      "builds",
      {},
      actor,
      traceparent,
    );
    expect(engine.get).toHaveBeenCalledWith(
      `/api/v1/projects/${projectId}/builds`,
      expect.any(Object),
    );
  });

  it("relays deployment detail", async () => {
    const engine = engineStub();
    await new ProjectOperationsService(engine.value).deployment(
      deploymentId,
      actor,
      traceparent,
    );
    expect(engine.get).toHaveBeenCalledWith(
      `/api/v1/deployments/${deploymentId}`,
      expect.any(Object),
    );
  });

  it("relays deploy and rollback bodies with idempotency context", async () => {
    const engine = engineStub();
    const service = new ProjectOperationsService(engine.value);
    const deployInput = {
      environment_id: "env_018f47a5-7b2c-7d10-8f11-123456789abc",
      requested_region: "eu-west-1",
    };
    const rollbackInput = { version_id: "ver_018f47a5" };

    await service.deploy(
      projectId,
      deployInput,
      actor,
      traceparent,
      "deploy-key",
    );
    await service.rollback(
      projectId,
      rollbackInput,
      actor,
      traceparent,
      "rollback-key",
    );

    expect(engine.post).toHaveBeenNthCalledWith(
      1,
      `/api/v1/projects/${projectId}/actions/deploy`,
      deployInput,
      expect.objectContaining({ permissions: actor.permissions }),
      { idempotencyKey: "deploy-key" },
    );
    expect(engine.post).toHaveBeenNthCalledWith(
      2,
      `/api/v1/projects/${projectId}/actions/rollback`,
      rollbackInput,
      expect.any(Object),
      { idempotencyKey: "rollback-key" },
    );
  });

  it("relays handoff body unchanged", async () => {
    const engine = engineStub();
    const input = { format: "zip", include_history: true };
    await new ProjectOperationsService(engine.value).handoff(
      conversationId,
      input,
      actor,
      traceparent,
      "handoff-key",
    );
    expect(engine.post).toHaveBeenCalledWith(
      `/api/v1/conversations/${conversationId}/actions/handoff`,
      input,
      expect.any(Object),
      { idempotencyKey: "handoff-key" },
    );
  });

  it("generates missing auth time and traceparent", async () => {
    const engine = engineStub();
    const actorWithoutAuthTime = { ...actor };
    delete actorWithoutAuthTime.auth_time;
    await new ProjectOperationsService(engine.value).repository(
      projectId,
      actorWithoutAuthTime,
      undefined,
    );
    expect(engine.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        authTime: expect.any(Number),
        traceparent: expect.stringMatching(
          /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
        ),
      }),
    );
  });

  it("rejects missing workspace before Engine call", () => {
    const engine = engineStub();
    const actorWithoutWorkspace = { ...actor };
    delete actorWithoutWorkspace.workspace_id;
    expect(() =>
      new ProjectOperationsService(engine.value).repository(
        projectId,
        actorWithoutWorkspace,
        traceparent,
      ),
    ).toThrowError(expect.objectContaining({
      status: 403,
      response: expect.objectContaining({
        error_code: "PROJECT_WORKSPACE_REQUIRED",
      }),
    }));
    expect(engine.get).not.toHaveBeenCalled();
  });

  it.each([
    ["repository", () => new ProjectOperationsService(engineStub().value).repository("bad", actor, traceparent)],
    ["collection", () => new ProjectOperationsService(engineStub().value).collection("bad", "builds", {}, actor, traceparent)],
    ["deployment", () => new ProjectOperationsService(engineStub().value).deployment("bad", actor, traceparent)],
    ["deploy", () => new ProjectOperationsService(engineStub().value).deploy("bad", {}, actor, traceparent, "key")],
    ["rollback", () => new ProjectOperationsService(engineStub().value).rollback("bad", {}, actor, traceparent, "key")],
    ["handoff", () => new ProjectOperationsService(engineStub().value).handoff("bad", {}, actor, traceparent, "key")],
  ] as const)("rejects invalid id for %s", (_name, operation) => {
    expect(operation).toThrowError(expect.objectContaining({
      status: 400,
      response: expect.objectContaining({
        error_code: "PROJECT_VALIDATION_FAILED",
      }),
    }));
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
