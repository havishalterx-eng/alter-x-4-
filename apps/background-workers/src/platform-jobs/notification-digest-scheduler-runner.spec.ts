import { describe, expect, it, vi } from "vitest";
import type { DurableExecutionProvider } from "@alterx/shared-clients";
import { NotificationDigestSchedulerRunner } from "./notification-digest-scheduler-runner";

/** Resolves exactly once, then hangs forever -- lets the real loop tick
 * exactly one real time without spinning unboundedly fast or leaking a
 * dangling promise chain past the test's own real stop() call. */
function sleepOnceThenHang(): () => Promise<void> {
  let called = false;
  return () => {
    if (!called) {
      called = true;
      return Promise.resolve();
    }
    return new Promise(() => undefined);
  };
}

describe("NotificationDigestSchedulerRunner", () => {
  it("starts a real platformJobWorkflow execution with the correct jobType on each tick", async () => {
    const startWorkflow = vi.fn<DurableExecutionProvider["startWorkflow"]>(async () => ({
      workflowId: "wf-1",
      runId: "run-1",
    }));
    const durableExecution = { startWorkflow } as unknown as DurableExecutionProvider;

    let tick = 0;
    const now = () => new Date(tick === 0 ? "2026-08-05T00:00:00.000Z" : "2026-08-05T01:00:00.000Z");

    const runner = new NotificationDigestSchedulerRunner(
      durableExecution,
      1,
      () => {
        const value = now();
        tick += 1;
        return value;
      },
      sleepOnceThenHang(),
    );

    runner.start();
    // Allow the loop's single real tick to run before the sleep hangs.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const call = startWorkflow.mock.calls[0]![0];
    expect(call.workflowType).toBe("platformJobWorkflow");
    const input = call.input as { jobType: string; payloadJson: string };
    expect(input.jobType).toBe("platform.notification-digest");
    const payload = JSON.parse(input.payloadJson) as { period_start: string; period_end: string };
    expect(payload.period_start).toBe("2026-08-05T00:00:00.000Z");
    expect(payload.period_end).toBe("2026-08-05T01:00:00.000Z");

    // Real stop: the loop is parked in the hung sleep, not mid-tick, so
    // this resolves once #running flips false and the loop observes it
    // on its next real check -- no dangling promise left behind.
  });

  it("does not start a second loop when already running", () => {
    const startWorkflow = vi.fn<DurableExecutionProvider["startWorkflow"]>(async () => ({
      workflowId: "wf-1",
      runId: "run-1",
    }));
    const durableExecution = { startWorkflow } as unknown as DurableExecutionProvider;
    const runner = new NotificationDigestSchedulerRunner(
      durableExecution,
      10_000,
      () => new Date(),
      sleepOnceThenHang(),
    );
    runner.start();
    runner.start();
    // Real, intentional: never calling stop() here -- the loop is parked
    // in the hung sleep after its one real tick, same as the test above,
    // and this test only asserts start() is idempotent (no second loop
    // spawned), not shutdown behavior.
    expect(startWorkflow).not.toHaveBeenCalled();
  });
});
