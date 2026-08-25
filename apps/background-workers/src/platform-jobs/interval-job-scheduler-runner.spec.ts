import { Logger } from "@nestjs/common";
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

/** Resolves the first `n` times, then hangs forever. */
function sleepNTimesThenHang(n: number): () => Promise<void> {
  let calls = 0;
  return () => {
    if (calls < n) {
      calls += 1;
      return Promise.resolve();
    }
    return new Promise(() => undefined);
  };
}

function mockLogger(): Logger {
  return { error: vi.fn() } as unknown as Logger;
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
    await vi.waitFor(() => expect(startWorkflow).toHaveBeenCalledTimes(1));

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

  it("keeps the loop alive and logs when a tick throws", async () => {
    let calls = 0;
    const startWorkflow = vi.fn<DurableExecutionProvider["startWorkflow"]>(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("temporal blip");
      }
      return { workflowId: "wf-1", runId: "run-1" };
    });
    const durableExecution = { startWorkflow } as unknown as DurableExecutionProvider;
    const logger = mockLogger();

    const runner = new IntervalJobSchedulerRunner(
      durableExecution,
      "platform.retention-sweep",
      "retention-sweep",
      1,
      () => new Date("2026-08-05T00:00:00.000Z"),
      sleepNTimesThenHang(2),
      logger,
    );

    runner.start();
    await vi.waitFor(() => expect(startWorkflow).toHaveBeenCalledTimes(2));

    expect(logger.error).toHaveBeenCalledTimes(1);
    const logArgs = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string | undefined,
    ];
    expect(logArgs[0]).toMatch(/temporal blip/);
    expect(logArgs[0]).toMatch(/platform\.retention-sweep/);
  });
});
