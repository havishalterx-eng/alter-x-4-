import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../rbac/types";
import type { OnboardingRepository } from "./onboarding.repository";
import { OnboardingService, onboardingEtag } from "./onboarding.service";
import { onboardingStepKeys } from "./step-config";
import type { OnboardingState } from "./types";

const actor: ActorContext = {
  user_id: "user",
  tenant_id: "tenant-a",
  workspace_id: "workspace-a",
  roles: ["viewer"],
  permissions: [],
  session_id: "session",
};

function initialState(): OnboardingState {
  return {
    id: "state",
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    steps: onboardingStepKeys.map((stepKey) => ({
      stepKey,
      status: "pending",
      completedAt: null,
    })),
    currentStep: onboardingStepKeys[0],
    status: "not_started",
    createdAt: new Date("2026-07-22T00:00:00.000Z"),
    updatedAt: new Date("2026-07-22T00:00:00.000Z"),
  };
}

class MemoryRepository {
  state: OnboardingState | null = initialState();

  async find(tenantId: string, workspaceId: string) {
    return this.state?.tenantId === tenantId && this.state.workspaceId === workspaceId
      ? structuredClone(this.state)
      : null;
  }

  async save(state: OnboardingState, expectedUpdatedAt: Date) {
    if (
      !this.state ||
      this.state.updatedAt.getTime() !== expectedUpdatedAt.getTime()
    ) {
      return null;
    }
    this.state = {
      ...structuredClone(state),
      updatedAt: new Date(this.state.updatedAt.getTime() + 1_000),
    };
    return structuredClone(this.state);
  }
}

describe("OnboardingService", () => {
  it("runs not_started to in_progress to completed", async () => {
    const repository = new MemoryRepository();
    const service = new OnboardingService(
      repository as Pick<OnboardingRepository, "find" | "save">,
      () => new Date("2026-07-22T01:00:00.000Z"),
    );

    let state = await service.get(actor);
    expect(state.status).toBe("not_started");
    expect(state.progress).toEqual({ completed: 0, total: 5, percent: 0 });
    for (const stepKey of onboardingStepKeys) {
      state = await service.update(
        actor,
        undefined,
        { action: "complete", stepKey },
        onboardingEtag(state),
      );
    }
    expect(state.status).toBe("completed");
    expect(state.currentStep).toBeNull();
    expect(state.progress).toEqual({ completed: 5, total: 5, percent: 100 });
  });

  it("supports in_progress to skipped", async () => {
    const repository = new MemoryRepository();
    const service = new OnboardingService(repository);
    let state = await service.get(actor);
    state = await service.update(
      actor,
      undefined,
      { action: "complete", stepKey: "choose_mode" },
      onboardingEtag(state),
    );
    const skipped = await service.update(
      actor,
      undefined,
      { action: "skip" },
      onboardingEtag(state),
    );
    expect(skipped.status).toBe("skipped");
    expect(skipped.currentStep).toBeNull();
  });

  it("treats repeated completion as no-op", async () => {
    const state = initialState();
    state.steps[0] = {
      stepKey: "choose_mode",
      status: "completed",
      completedAt: "2026-07-22T01:00:00.000Z",
    };
    state.currentStep = "create_first_item";
    state.status = "in_progress";
    const repository = {
      find: vi.fn().mockResolvedValue(state),
      save: vi.fn(),
    };
    const service = new OnboardingService(repository);
    await expect(
      service.update(
        actor,
        undefined,
        { action: "complete", stepKey: "choose_mode" },
        onboardingEtag(state),
      ),
    ).resolves.toMatchObject({ status: "in_progress" });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("allows one concurrent update and rejects stale writer", async () => {
    const repository = new MemoryRepository();
    const service = new OnboardingService(repository);
    const state = await service.get(actor);
    const patch = () =>
      service.update(
        actor,
        undefined,
        { action: "complete", stepKey: "choose_mode" },
        onboardingEtag(state),
      );
    const results = await Promise.allSettled([patch(), patch()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { status: 412 } });
  });

  it("denies cross-workspace access and missing workspace context", async () => {
    const service = new OnboardingService(new MemoryRepository());
    await expect(service.get(actor, "workspace-b")).rejects.toMatchObject({ status: 403 });
    const { workspace_id: _workspaceId, ...actorWithoutWorkspace } = actor;
    void _workspaceId;
    await expect(service.get(actorWithoutWorkspace)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects missing ETag, stale ETag, out-of-order step, and early skip", async () => {
    const service = new OnboardingService(new MemoryRepository());
    await expect(
      service.update(actor, undefined, { action: "skip" }, undefined),
    ).rejects.toMatchObject({ status: 428 });
    await expect(
      service.update(actor, undefined, { action: "skip" }, '"stale"'),
    ).rejects.toMatchObject({ status: 412 });
    const state = await service.get(actor);
    await expect(
      service.update(
        actor,
        undefined,
        { action: "complete", stepKey: "invite_team" },
        onboardingEtag(state),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.update(actor, undefined, { action: "skip" }, onboardingEtag(state)),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("returns not found when state does not exist", async () => {
    const repository = new MemoryRepository();
    repository.state = null;
    await expect(new OnboardingService(repository).get(actor)).rejects.toMatchObject({
      status: 404,
    });
  });
});
