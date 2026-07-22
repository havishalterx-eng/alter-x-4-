import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { OnboardingRepository } from "./onboarding.repository";
import type { OnboardingState } from "./types";

const row = {
  id: "state",
  tenant_id: "tenant",
  workspace_id: "workspace",
  steps: [],
  current_step: "choose_mode",
  status: "not_started",
  created_at: new Date("2026-07-22T00:00:00.000Z"),
  updated_at: new Date("2026-07-22T00:00:00.000Z"),
};

function setup(rows = [row]) {
  const query = vi.fn().mockImplementation(async (sql: string) =>
    sql.includes("onboarding_states") ? { rows } : { rows: [] },
  );
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return { repository: new OnboardingRepository(pool), client, query, release };
}

describe("OnboardingRepository", () => {
  it("initializes state using caller transaction", async () => {
    const { repository, client, query } = setup();
    await expect(repository.initialize("tenant", "workspace", client)).resolves.toMatchObject({
      tenantId: "tenant",
      workspaceId: "workspace",
      status: "not_started",
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO onboarding_states"),
      expect.arrayContaining(["tenant", "workspace"]),
    );
  });

  it("reads and saves under tenant RLS transaction", async () => {
    const { repository, query, release } = setup();
    const state = await repository.find("tenant", "workspace");
    expect(state).toMatchObject({ tenantId: "tenant" });
    await expect(
      repository.save(state as OnboardingState, (state as OnboardingState).updatedAt),
    ).resolves.toMatchObject({ workspaceId: "workspace" });
    expect(query).toHaveBeenCalledWith(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      ["tenant"],
    );
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("returns null for missing state and stale update", async () => {
    const { repository } = setup([]);
    await expect(repository.find("tenant", "workspace")).resolves.toBeNull();
    const state = {
      id: "state",
      tenantId: "tenant",
      workspaceId: "workspace",
      steps: [],
      currentStep: null,
      status: "completed",
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies OnboardingState;
    await expect(repository.save(state, state.updatedAt)).resolves.toBeNull();
  });

  it("rolls back and releases on query failure", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("query failed"))
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    await expect(
      new OnboardingRepository(pool).find("tenant", "workspace"),
    ).rejects.toThrow("query failed");
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
