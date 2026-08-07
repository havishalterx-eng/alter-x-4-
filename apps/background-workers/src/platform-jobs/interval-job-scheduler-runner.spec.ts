import { describe, expect, it, vi } from "vitest";
import type { DurableExecutionProvider } from "@alterx/shared-clients";
import { IntervalJobSchedulerRunner } from "./interval-job-scheduler-runner";

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

describe("IntervalJobSchedulerRunner", () => {
  it("starts a real platformJobWorkflow execution with the configured jobType on each tick", async () => {
    const startWorkflow = vi.fn<DurableExecutionProvider["startWorkflow"]>(async () => ({
      workflowId: "wf-1",
      runId: "run-1",
    }));
    const durableExecution = { startWorkflow } as unknown as DurableExecutionProvider;

    const runner = new IntervalJobSchedulerRunner(
      durableExecution,
      "platform.retention-sweep",
      "retention-sweep",
      1,
      () => new Date("2026-08-05T00:00:00.000Z"),
      sleepOnceThenHang(),
    );

    runner.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const call = startWorkflow.mock.calls[0]![0];
    expect(call.workflowType).toBe("platformJobWorkflow");
    expect(call.workflowId).toBe(`retention-sweep-${new Date("2026-08-05T00:00:00.000Z").getTime()}`);
    const input = call.input as { jobType: string; payloadJson: string };
    expect(input.jobType).toBe("platform.retention-sweep");
    expect(JSON.parse(input.payloadJson)).toEqual({});
  });

  it("does not start a second loop when already running", () => {
    const startWorkflow = vi.fn<DurableExecutionProvider["startWorkflow"]>(async () => ({
      workflowId: "wf-1",
      runId: "run-1",
    }));
    const durableExecution = { startWorkflow } as unknown as DurableExecutionProvider;
    const runner = new IntervalJobSchedulerRunner(
      durableExecution,
      "platform.connector-health-sweep",
      "connector-health-sweep",
      10_000,
      () => new Date(),
      sleepOnceThenHang(),
    );
    runner.start();
    runner.start();
    expect(startWorkflow).not.toHaveBeenCalled();
  });
});
