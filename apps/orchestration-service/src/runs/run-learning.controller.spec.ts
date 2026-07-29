import { describe, expect, it, vi } from "vitest";

import {
  RunOutcomeNotCompletedError,
  RunOutcomeRunNotFoundError,
  RunOutcomeService,
} from "./run-outcome.service";
import { RunLearningController } from "./run-learning.controller";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ad";

function service(): RunOutcomeService {
  return { getLearningSummary: vi.fn() } as unknown as RunOutcomeService;
}

function request(tenantId: string | null = TENANT) {
  return {
    actorContext: tenantId === null ? undefined : { tenant_id: tenantId },
    url: `/internal/runs/${RUN}/outcome-summary`,
  };
}

describe("RunLearningController", () => {
  it("uses authenticated tenant context and returns the minimal summary", async () => {
    const outcomes = service();
    vi.mocked(outcomes.getLearningSummary).mockResolvedValue({
      tenant_id: TENANT,
      run_id: RUN,
      workspace_id: "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ac",
      verdict: "failed",
      gates_passed: 1,
      gates_failed: 1,
      recovery_count: 1,
      nodes: [],
      recovery_actions: [],
    });

    const result = await new RunLearningController(outcomes).summary(
      request() as never,
      RUN,
    );
    expect(result.verdict).toBe("failed");
    expect(outcomes.getLearningSummary).toHaveBeenCalledWith(TENANT, RUN);
  });

  it.each([
    [new RunOutcomeRunNotFoundError(RUN), 404],
    [new RunOutcomeNotCompletedError(RUN), 409],
  ] as const)("maps typed errors to HTTP %s", async (error, expectedStatus) => {
    const outcomes = service();
    vi.mocked(outcomes.getLearningSummary).mockRejectedValue(error);
    await expect(
      new RunLearningController(outcomes).summary(request() as never, RUN),
    ).rejects.toMatchObject({
      status: expectedStatus,
      response: expect.objectContaining({
        status: expectedStatus,
        trace_id: expect.stringMatching(/^trc_[0-9a-f-]+$/i),
        request_id: expect.stringMatching(/^req_[0-9a-f-]+$/i),
      }),
    });
  });

  it("fails closed when authenticated tenant context is missing", async () => {
    await expect(
      new RunLearningController(service()).summary(request(null) as never, RUN),
    ).rejects.toMatchObject({ status: 500 });
  });
});
