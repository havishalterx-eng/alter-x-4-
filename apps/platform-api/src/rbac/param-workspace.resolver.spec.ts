import { describe, expect, it, vi } from "vitest";

import {
  EngineProjectWorkspaceLookup,
  ParamWorkspaceResolver,
  WorkspaceLookupUnavailableError,
  type ProjectWorkspaceLookup,
} from "./param-workspace.resolver";
import type { ActorContext as ActorContextType } from "./types";

const tenantId = "018f47a5-7b2c-7d10-8f11-123456789abc";
const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const workspaceA = "ws_018f47a5-7b2c-7d10-8f11-123456789aba";
const workspaceB = "ws_018f47a5-7b2c-7d10-8f11-123456789abb";

function request(
  params: Record<string, string>,
  actor?: Partial<ActorContextType>,
): Parameters<ParamWorkspaceResolver["resolveWorkspaceId"]>[0] {
  return {
    params,
    url: "/test",
    ...(actor === undefined
      ? {}
      : {
          actorContext: {
            user_id: "usr_x",
            tenant_id: tenantId,
            roles: [],
            permissions: [],
            session_id: "sess_x",
            ...actor,
          },
        }),
  } as Parameters<ParamWorkspaceResolver["resolveWorkspaceId"]>[0];
}

describe("ParamWorkspaceResolver", () => {
  it("returns a direct workspaceId param without any lookup", async () => {
    const lookup = vi.fn();
    const resolver = new ParamWorkspaceResolver({ getProjectWorkspace: lookup });

    const resolved = await resolver.resolveWorkspaceId(request({ workspaceId: workspaceA }));

    expect(resolved).toBe(workspaceA);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("resolves a projectId param through the project lookup", async () => {
    const lookup = vi.fn<(t: string, p: string) => Promise<string | undefined>>(
      async () => workspaceB,
    );
    const resolver = new ParamWorkspaceResolver({ getProjectWorkspace: lookup });

    const resolved = await resolver.resolveWorkspaceId(
      request({ projectId }, {}),
    );

    expect(resolved).toBe(workspaceB);
    expect(lookup).toHaveBeenCalledWith(tenantId, projectId);
  });

  it("returns undefined for a projectId param when the actor carries no tenant context", async () => {
    const lookup = vi.fn();
    const resolver = new ParamWorkspaceResolver({ getProjectWorkspace: lookup });

    await expect(
      resolver.resolveWorkspaceId(request({ projectId })),
    ).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns undefined for routes that name no workspace-bearing param", async () => {
    const resolver = new ParamWorkspaceResolver({ getProjectWorkspace: async () => workspaceA });

    await expect(resolver.resolveWorkspaceId(request({}))).resolves.toBeUndefined();
    await expect(
      resolver.resolveWorkspaceId(request({ runId: "run_1" })),
    ).resolves.toBeUndefined();
  });

  it("returns undefined for projectId routes when no project lookup is wired (legacy flat path)", async () => {
    const resolver = new ParamWorkspaceResolver();

    await expect(
      resolver.resolveWorkspaceId(request({ projectId })),
    ).resolves.toBeUndefined();
  });
});

type FakeEngineClient = {
  get: (
    path: string,
    context: unknown,
  ) => Promise<{ status: number; body?: Record<string, unknown> }>;
};

function fakeClient(
  impl: FakeEngineClient["get"],
): unknown {
  return { get: vi.fn(impl) };
}

describe("EngineProjectWorkspaceLookup", () => {
  it("returns the project's owning workspace from the engine read", async () => {
    const client = fakeClient(async () => ({
      status: 200,
      body: { id: projectId, workspace_id: workspaceA },
    }));
    const lookup = new EngineProjectWorkspaceLookup(client as never);

    await expect(lookup.getProjectWorkspace(tenantId, projectId)).resolves.toBe(workspaceA);
  });

  it("collapses a foreign/missing project to undefined via the engine's 404", async () => {
    const client = fakeClient(async () => ({ status: 404 }));
    const lookup = new EngineProjectWorkspaceLookup(client as never);

    await expect(lookup.getProjectWorkspace(tenantId, projectId)).resolves.toBeUndefined();
  });

  it("fails closed on any non-200/404 engine response", async () => {
    const client = fakeClient(async () => ({ status: 503 }));
    const lookup = new EngineProjectWorkspaceLookup(client as never);

    await expect(lookup.getProjectWorkspace(tenantId, projectId)).rejects.toBeInstanceOf(
      WorkspaceLookupUnavailableError,
    );
  });

  it("never caches a failed lookup, so recovery needs no TTL wait", async () => {
    let status = 503;
    const client = fakeClient(async () =>
      status === 200
        ? { status: 200, body: { workspace_id: workspaceA } }
        : { status },
    );
    const lookup = new EngineProjectWorkspaceLookup(client as never);

    await expect(lookup.getProjectWorkspace(tenantId, projectId)).rejects.toBeInstanceOf(
      WorkspaceLookupUnavailableError,
    );
    status = 200;
    await expect(lookup.getProjectWorkspace(tenantId, projectId)).resolves.toBe(workspaceA);
  });

  it("caches a positive result so repeat checks do not re-hit the engine", async () => {
    const get = vi.fn(async () => ({
      status: 200,
      body: { workspace_id: workspaceA },
    }));
    const lookup = new EngineProjectWorkspaceLookup({ get } as never);

    await expect(lookup.getProjectWorkspace(tenantId, projectId)).resolves.toBe(workspaceA);
    await expect(lookup.getProjectWorkspace(tenantId, projectId)).resolves.toBe(workspaceA);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("guard wiring contract (compile-time shape)", () => {
  it("accepts any ProjectWorkspaceLookup implementation", async () => {
    const stub: ProjectWorkspaceLookup = {
      getProjectWorkspace: async () => undefined,
    };
    await expect(stub.getProjectWorkspace(tenantId, projectId)).resolves.toBeUndefined();
  });
});
