import { describe, expect, it, vi } from "vitest";
import type { ActorContextType } from "../rbac";
import { AnnotationController } from "./annotation.controller";
import { AnnotationRepository } from "./annotation.repository";

const actor: ActorContextType = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abd",
  tenant_id: "018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abe",
  roles: ["editor"],
  permissions: [],
  session_id: "session-editor",
};

describe("AnnotationController", () => {
  it("appends trimmed notes and reads annotations through tenant scope", async () => {
    const repository = {
      create: vi.fn().mockResolvedValue({ id: "ain_1", note: "reviewed" }),
      list: vi.fn().mockResolvedValue([{ id: "ain_1", note: "reviewed" }]),
    };
    const controller = new AnnotationController(repository as unknown as AnnotationRepository);

    await expect(
      controller.create("approval", "apr_018f47a5-7b2c-7d10-8f11-123456789abf", { note: "  reviewed  " }, actor),
    ).resolves.toEqual({ id: "ain_1", note: "reviewed" });
    expect(repository.create).toHaveBeenCalledWith(
      actor.tenant_id,
      "approval",
      "apr_018f47a5-7b2c-7d10-8f11-123456789abf",
      "reviewed",
      actor.user_id,
    );

    await expect(
      controller.list("escalation", "esc_018f47a5-7b2c-7d10-8f11-123456789abf", actor),
    ).resolves.toEqual([{ id: "ain_1", note: "reviewed" }]);
    expect(repository.list).toHaveBeenCalledWith(
      actor.tenant_id,
      "escalation",
      "esc_018f47a5-7b2c-7d10-8f11-123456789abf",
    );
  });

  it("rejects missing actors, invalid IDs, types, and notes before writing", async () => {
    const repository = { create: vi.fn(), list: vi.fn() };
    const controller = new AnnotationController(repository as unknown as AnnotationRepository);

    expect(() =>
      controller.create(
        "approval",
        "apr_018f47a5-7b2c-7d10-8f11-123456789abf",
        { note: "note" },
        undefined,
      ),
    ).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => controller.list("unknown", "apr_018f47a5-7b2c-7d10-8f11-123456789abf", actor)).toThrow();
    expect(() => controller.list("approval", "bad-id", actor)).toThrow();
    expect(() => controller.create("approval", "apr_018f47a5-7b2c-7d10-8f11-123456789abf", { note: "   " }, actor)).toThrow();
    expect(() => controller.create("approval", "apr_018f47a5-7b2c-7d10-8f11-123456789abf", { note: "x".repeat(4001) }, actor)).toThrow();
    expect(repository.create).not.toHaveBeenCalled();
  });
});
