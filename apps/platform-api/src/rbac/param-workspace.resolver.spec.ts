import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineClient } from "../engine/engine-client";
import {
  CachedEngineResourceLookup,
  ConnectionWorkspaceLookup,
  defaultWorkspaceResolutionRules,
  legacyFlatRules,
  ParamWorkspaceResolver,
  WorkspaceLookupUnavailableError,
  type ResourceWorkspaceLookup,
  type WorkspaceResolutionRule,
} from "./param-workspace.resolver";
import type { PlatformDb } from "../signup/platform-db";
import type { RbacRequest } from "./types";

const tenantId = "018f47a5-7b2c-7d10-8f11-123456789abc";
const workspaceA = "ws_018f47a5-7b2c-7d10-8f11-123456789aba";
const workspaceB = "ws_018f47a5-7b2c-7d10-8f11-123456789abb";
const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const workflowId = "wf_018f47a5-7b2c-7d10-8f11-123456789abc";
const runId = "run_018f47a5-7b2c-7d10-8f11-123456789abc";
const artifactId = "art_018f47a5-7b2c-7d10-8f11-123456789abc";
const sourceId = "src_018f47a5-7b2c-7d10-8f11-123456789abc";
const documentId = "doc_018f47a5-7b2c-7d10-8f11-123456789abc";
const jobId = "job_018f47a5-7b2c-7d10-8f11-123456789abc";
const triggerId = "trg_018f47a5-7b2c-7d10-8f11-123456789abc";
const approvalId = "apr_018f47a5-7b2c-7d10-8f11-123456789abc";
const escalationId = "esc_018f47a5-7b2c-7d10-8f11-123456789abc";
const clarificationId = "clr_018f47a5-7b2c-7d10-8f11-123456789abc";
const connectionId = "018f47a5-7b2c-7d10-8f11-123456789abd";

function request(
  params: Record<string, string>,
  url = "/test",
): RbacRequest {
  return {
    params,
    url,
    actorContext: {
      user_id: "usr_x",
      tenant_id: tenantId,
      roles: [],
      permissions: [],
      session_id: "sess_x",
    },
  };
}

function staticLookup(value: string | undefined): ResourceWorkspaceLookup {
  return { getWorkspaceId: async () => value };
}

describe("defaultWorkspaceResolutionRules dispatch", () => {
  const getMock = vi.fn<(path: string) => Promise<{ status: number; body?: Record<string, unknown> }>>(
    async (path) => {
      if (path.includes("/workflows/")) return { status: 200, body: { workspace_id: workspaceA } };
      if (path.includes("/projects/")) return { status: 200, body: { workspace_id: workspaceA } };
      if (path.includes("/runs/")) return { status: 200, body: { workspace_id: workspaceB } };
      if (path.includes("/artifacts/")) return { status: 200, body: { workspaceId: workspaceB } };
      if (path.includes("/ads/sources/")) return { status: 200, body: { workspace_id: workspaceA } };
      if (path.includes("/ads/documents/")) return { status: 200, body: { workspace_id: workspaceB } };
      if (path.includes("/ads/ingestion/jobs/")) return { status: 200, body: { workspace_id: workspaceA } };
      if (path.includes("/triggers/")) return { status: 200, body: { workspaceId: workspaceB } };
      if (path.includes("/approvals/")) return { status: 200, body: { workspace_id: workspaceA } };
      if (path.includes("/escalations/")) return { status: 200, body: { workspace_id: workspaceB } };
      if (path.includes("/clarifications/")) return { status: 200, body: { workspace_id: workspaceA } };
      if (path.endsWith("/missing")) return { status: 404 };
      return { status: 500 };
    },
  );
  const queryTenantMock = vi.fn<
    (tenantId: string, sql: string, params: readonly unknown[]) => Promise<Record<string, unknown>[]>
  >(async () => [{ workspace_id: workspaceA }]);
  const deps = {
    engineClient: { get: getMock } as unknown as EngineClient,
    db: { queryTenant: queryTenantMock } as unknown as PlatformDb,
  };
  const resolver = new ParamWorkspaceResolver(defaultWorkspaceResolutionRules(deps));

  beforeEach(() => {
    getMock.mockClear();
    queryTenantMock.mockClear();
  });

  it.each([
    ["projects", "/api/v1/projects/p/env-vars", { projectId }, workspaceA],
    ["workflows", "/api/v1/workflows/w/actions/compile", { workflowId: workflowId }, workspaceA],
    ["runs", "/api/v1/runs/r", { runId }, workspaceB],
    ["artifacts", "/api/v1/artifacts/f/download", { artifactId }, workspaceB],
    ["ads sources", "/api/v1/ads/sources/s/permissions", { sourceId }, workspaceA],
    ["ads documents", "/api/v1/ads/documents/d/permissions", { documentId }, workspaceB],
    ["ads ingestion jobs", "/api/v1/ads/ingestion/jobs/j", { jobId }, workspaceA],
    ["triggers (bare id)", "/api/v1/triggers/t/status", { id: triggerId }, workspaceB],
    ["approvals", "/api/v1/approvals/a/actions/approve", { approvalId: approvalId }, workspaceA],
    ["escalations", "/api/v1/escalations/e/actions/claim", { escalationId: escalationId }, workspaceB],
    ["clarifications", "/api/v1/clarifications/c/actions/assign", { clarificationId: clarificationId }, workspaceA],
  ])("resolves %s", async (_label, url, params, expected) => {
    await expect(
      resolver.resolveWorkspaceId(request(params as Record<string, string>, url)),
    ).resolves.toBe(expected);
  });

  it("passes a direct workspaceId param through without any lookup", async () => {
    await expect(
      resolver.resolveWorkspaceId(request({ workspaceId: workspaceA })),
    ).resolves.toBe(workspaceA);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("extracts snake_case workspace_id from run reads and camelCase from trigger reads", async () => {
    await expect(
      resolver.resolveWorkspaceId(request({ runId }, "/api/v1/runs/x")),
    ).resolves.toBe(workspaceB);
    await expect(
      resolver.resolveWorkspaceId(request({ id: triggerId }, "/api/v1/triggers/x")),
    ).resolves.toBe(workspaceB);
  });

  it("maps annotation items by their sibling type param", async () => {
    getMock.mockClear();
    getMock.mockImplementation(async (path: string) =>
      path.includes("/escalations/")
        ? { status: 200, body: { workspace_id: workspaceA } }
        : { status: 404 },
    );

    await expect(
      resolver.resolveWorkspaceId(
        request({ type: "escalation", id: escalationId }, "/api/v1/action-items/escalation/e/annotations"),
      ),
    ).resolves.toBe(workspaceA);
    expect(getMock).toHaveBeenCalledWith(
      `/api/v1/escalations/${escalationId}`,
      expect.objectContaining({ tenantId }),
    );
  });

  it("returns undefined for an unknown annotation type instead of guessing", async () => {
    await expect(
      resolver.resolveWorkspaceId(
        request({ type: "mystery", id: "x" }, "/api/v1/action-items/mystery/x/annotations"),
      ),
    ).resolves.toBeUndefined();
  });

  it("resolves connection ids from the local platform_db, not the engine", async () => {
    await expect(
      resolver.resolveWorkspaceId(
        request({ connectionId }, "/api/v1/integrations/connections/c/actions/health"),
      ),
    ).resolves.toBe(workspaceA);
    expect(deps.db.queryTenant).toHaveBeenCalledWith(
      tenantId,
      expect.stringContaining("oauth_connections"),
      expect.anything(),
    );
    expect(getMock).not.toHaveBeenCalledWith(
      expect.stringContaining("connections"),
      expect.anything(),
    );
  });

  it("treats a malformed connection id as missing rather than querying", async () => {
    await expect(
      resolver.resolveWorkspaceId(
        request({ connectionId: "not-a-uuid" }, "/api/v1/integrations/connections/x/health"),
      ),
    ).resolves.toBeUndefined();
    expect(queryTenantMock).not.toHaveBeenCalled(); // beforeEach-cleared; malformed never reaches the DB
  });

  it("keeps unrelated generic :id routes unbound (documented legacy path)", async () => {
    await expect(
      resolver.resolveWorkspaceId(request({ id: triggerId }, "/api/v1/channels/voice/id")),
    ).resolves.toBeUndefined();
  });
});

describe("CachedEngineResourceLookup caching contract", () => {
  it("caches positive results per resource and never re-fetches within TTL", async () => {
    const get = vi.fn(async () => ({ status: 200, body: { workspace_id: workspaceA } }));
    const lookup = new CachedEngineResourceLookup(
      { get } as never,
      (id) => `/api/v1/workflows/${id}`,
      (body) => (typeof body.workspace_id === "string" ? body.workspace_id : undefined),
    );

    await expect(lookup.getWorkspaceId(tenantId, workflowId)).resolves.toBe(workspaceA);
    await expect(lookup.getWorkspaceId(tenantId, workflowId)).resolves.toBe(workspaceA);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("collapses 404 to undefined with a short negative cache", async () => {
    const get = vi.fn(async () => ({ status: 404 }));
    const lookup = new CachedEngineResourceLookup(
      { get } as never,
      (id) => `/api/v1/workflows/${id}`,
      (body) => (typeof body.workspace_id === "string" ? body.workspace_id : undefined),
    );

    await expect(lookup.getWorkspaceId(tenantId, workflowId)).resolves.toBeUndefined();
    await expect(lookup.getWorkspaceId(tenantId, workflowId)).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("fails closed on non-200/404 and never caches the failure", async () => {
    let status = 503;
    const get = vi.fn(async () => ({
      status,
      body: status === 200 ? { workspace_id: workspaceA } : {},
    }));
    const lookup = new CachedEngineResourceLookup(
      { get } as never,
      (id) => `/api/v1/workflows/${id}`,
      (body) => (typeof body.workspace_id === "string" ? body.workspace_id : undefined),
    );

    await expect(lookup.getWorkspaceId(tenantId, workflowId)).rejects.toBeInstanceOf(
      WorkspaceLookupUnavailableError,
    );
    status = 200;
    await expect(lookup.getWorkspaceId(tenantId, workflowId)).resolves.toBe(workspaceA);
  });
});

describe("ConnectionWorkspaceLookup fail-closed contract", () => {
  it("surfaces database failure as WorkspaceLookupUnavailableError, not undefined", async () => {
    const db = {
      queryTenant: vi.fn(async (): Promise<Record<string, unknown>[]> => {
        throw new Error("pool exhausted");
      }),
    };
    const lookup = new ConnectionWorkspaceLookup(db as never);

    await expect(
      lookup.getWorkspaceId(tenantId, connectionId),
    ).rejects.toBeInstanceOf(WorkspaceLookupUnavailableError);
  });
});

describe("legacy composition", () => {
  it("binds nothing, so the guard keeps its documented flat-role behavior", async () => {
    const resolver = new ParamWorkspaceResolver(legacyFlatRules());

    await expect(
      resolver.resolveWorkspaceId(request({ projectId, workspaceId: workspaceB })),
    ).resolves.toBeUndefined();
    await expect(
      resolver.resolveWorkspaceId(request({ id: triggerId }, "/api/v1/triggers/t")),
    ).resolves.toBeUndefined();
  });

  it("accepts custom rule arrays additively", async () => {
    const rules: readonly WorkspaceResolutionRule[] = [
      { paramNames: ["customId"], lookup: staticLookup(workspaceB) },
    ];
    const resolver = new ParamWorkspaceResolver(rules);

    await expect(resolver.resolveWorkspaceId(request({ customId: "c" }))).resolves.toBe(workspaceB);
  });
});
