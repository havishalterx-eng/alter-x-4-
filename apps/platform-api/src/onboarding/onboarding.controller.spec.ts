import type { FastifyReply } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../rbac/types";
import { OnboardingController } from "./onboarding.controller";
import type { OnboardingService } from "./onboarding.service";

const actor: ActorContext = {
  user_id: "user",
  tenant_id: "tenant",
  workspace_id: "workspace",
  roles: ["viewer"],
  permissions: [],
  session_id: "session",
};

describe("OnboardingController", () => {
  it("returns RFC error for malformed PATCH action", async () => {
    const service = { update: vi.fn() } as unknown as OnboardingService;
    const reply = {} as FastifyReply;
    await expect(
      new OnboardingController(service).update(
        actor,
        undefined,
        '"etag"',
        { action: "complete", stepKey: "unknown" },
        reply,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(service.update).not.toHaveBeenCalled();
  });
});
