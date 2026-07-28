import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ActorContextType, RbacRequest } from "../rbac";
import { TriggerEtagResolver } from "./trigger-etag.resolver";
import type { TriggerService } from "./trigger.service";

const actor: ActorContextType = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session",
  roles: ["admin"],
  permissions: ["workflows:deploy"],
};
const triggerId = "trg_018f47a5-7b2c-7d10-8f11-123456789abc";

describe("TriggerEtagResolver", () => {
  it("resolves current trigger and handles array trace headers", async () => {
    const get = vi.fn().mockResolvedValue({
      status: 200,
      body: { id: triggerId, status: "draft" },
    });
    const resolver = new TriggerEtagResolver({ get } as unknown as TriggerService);
    const request = {
      url: `/api/v1/triggers/${triggerId}/status?source=test`,
      params: { id: triggerId },
      actorContext: actor,
      headers: { traceparent: ["trace-a", "trace-b"] },
    } as unknown as FastifyRequest & RbacRequest;

    await expect(resolver.resolve(request)).resolves.toEqual({
      resource: { id: triggerId, status: "draft" },
    });
    expect(get).toHaveBeenCalledWith(triggerId, actor, "trace-a");
  });

  it("rejects missing actor or id with fallback instance", async () => {
    const resolver = new TriggerEtagResolver({
      get: vi.fn(),
    } as unknown as TriggerService);
    await expect(
      resolver.resolve({
        url: "",
        headers: {},
      } as FastifyRequest),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        error_code: "INVALID_TRIGGER_REQUEST",
        instance: "/api/v1/triggers",
      },
    });
  });
});
