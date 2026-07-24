import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ActorContextType, RbacRequest } from "../rbac";
import { WorkflowEtagResolver } from "./workflow-etag.resolver";
import type { WorkflowService } from "./workflow.service";

const workflowId = "wf_018f47a5-7b2c-7d10-8f11-123456789abc";
const actor: ActorContextType = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session-a",
  roles: ["editor"],
  permissions: ["workflows:write"],
};

describe("WorkflowEtagResolver", () => {
  it("uses revision and first repeated trace header", async () => {
    const get = vi.fn().mockResolvedValue({
      status: 200,
      body: { revision: 2 },
    });
    const resolver = new WorkflowEtagResolver({ get } as unknown as WorkflowService);

    await expect(
      resolver.resolve(
        request({
          actorContext: actor,
          params: { workflowId },
          url: `/api/v1/workflows/${workflowId}?view=canvas`,
          traceparent: ["trace-first", "trace-second"],
        }),
      ),
    ).resolves.toEqual({ resource: { revision: 2 }, version: 2 });
    expect(get).toHaveBeenCalledWith(workflowId, actor, "trace-first");
  });

  it("supports version strings and resources without a version", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: { version: "draft-3" } })
      .mockResolvedValueOnce({ status: 200, body: { status: "draft" } });
    const resolver = new WorkflowEtagResolver({ get } as unknown as WorkflowService);
    const validRequest = request({
      actorContext: actor,
      params: { workflowId },
      url: `/api/v1/workflows/${workflowId}`,
      traceparent: "trace",
    });

    await expect(resolver.resolve(validRequest)).resolves.toEqual({
      resource: { version: "draft-3" },
      version: "draft-3",
    });
    await expect(resolver.resolve(validRequest)).resolves.toEqual({
      resource: { status: "draft" },
    });
  });

  it("rejects missing actor or workflow route parameter", async () => {
    const resolver = new WorkflowEtagResolver({
      get: vi.fn(),
    } as unknown as WorkflowService);

    await expect(
      resolver.resolve(
        request({
          params: { workflowId },
          url: "",
        }),
      ),
    ).rejects.toMatchObject({
      response: { error_code: "INVALID_WORKFLOW_REQUEST" },
    });
    await expect(
      resolver.resolve(
        request({
          actorContext: actor,
          params: {},
          url: "/api/v1/workflows",
        }),
      ),
    ).rejects.toMatchObject({
      response: { error_code: "INVALID_WORKFLOW_REQUEST" },
    });
  });
});

function request(input: {
  actorContext?: ActorContextType;
  params: Record<string, string>;
  url: string;
  traceparent?: string | string[];
}): FastifyRequest {
  return {
    url: input.url,
    params: input.params,
    headers: {
      ...(input.traceparent === undefined
        ? {}
        : { traceparent: input.traceparent }),
    },
    ...(input.actorContext === undefined
      ? {}
      : { actorContext: input.actorContext }),
  } as unknown as FastifyRequest & RbacRequest;
}
