import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ActorContextType, RbacRequest } from "../rbac";
import { EnvVarEtagResolver } from "./env-var-etag.resolver";
import { EnvVarService } from "./env-var.service";

const actor: ActorContextType = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abd",
  tenant_id: "018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session",
  roles: ["admin"],
  permissions: ["projects:write"],
};
const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const id = "018f47a5-7b2c-7d10-8f11-123456789abe";

describe("EnvVarEtagResolver", () => {
  it("resolves project environment variable version", async () => {
    const body = {
      id,
      project_id: projectId,
      environment: "production",
      key: "DATABASE_URL",
      last4: "****1234",
      created_at: "2026-08-04T10:00:00.000Z",
      version: "2026-08-04T10:00:00.000Z",
    };
    const get = vi.fn(async () => body);
    const resolver = new EnvVarEtagResolver({ get } as unknown as EnvVarService);
    const request = {
      actorContext: actor,
      params: { projectId, id },
      url: `/api/v1/projects/${projectId}/env-vars/${id}?x=1`,
    } as unknown as FastifyRequest & RbacRequest;

    await expect(resolver.resolve(request)).resolves.toEqual({
      resource: body,
      version: body.version,
    });
    expect(get).toHaveBeenCalledWith(
      actor.tenant_id,
      projectId,
      id,
      `/api/v1/projects/${projectId}/env-vars/${id}`,
    );
  });

  it("default-denies missing actor, project, or id", async () => {
    const resolver = new EnvVarEtagResolver({
      get: vi.fn(),
    } as unknown as EnvVarService);
    for (const request of [
      { url: "", params: {} },
      { url: "/api/v1/projects/x/env-vars/id", actorContext: actor, params: {} },
      {
        url: "/api/v1/projects/x/env-vars/id",
        actorContext: actor,
        params: { projectId },
      },
    ]) {
      await expect(
        resolver.resolve(request as unknown as FastifyRequest & RbacRequest),
      ).rejects.toMatchObject({ status: 400 });
    }
  });
});
