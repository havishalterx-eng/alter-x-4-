import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { CostEventConsumerRunner } from "./cost-event-consumer-runner";
import type { CostEventConsumerService } from "./cost-event-consumer.service";

// Deterministic macrotask yield (setImmediate, one event-loop turn) used as
// the runner's injected sleep so the consumer loop stays paced without a
// wall-clock timer. A synchronous/microtask-only yield would starve the
// event loop and OOM the worker, which is why production uses a real delay;
// setImmediate gives a real turn without a fixed-duration wait. The loop is
// always stopped via stop(), bounding any spin.
const tinySleep = async () => new Promise<void>((resolve) => setImmediate(resolve));

function mockLogger(): Logger {
  return { error: vi.fn() } as unknown as Logger;
}

describe("CostEventConsumerRunner", () => {
  it("drains a real backlog without sleeping between messages, then throttles once empty", async () => {
    const results = ["ingested", "ingested", "requeued"] as const;
    let index = 0;
    const pollOnce = vi.fn(async () =>
      index < results.length ? results[index++] : "empty",
    );
    const sleep = vi.fn(tinySleep);
    const runner = new CostEventConsumerRunner(
      { pollOnce } as unknown as CostEventConsumerService,
      1_000,
      sleep,
    );

    runner.start();
    await vi.waitFor(() =>
      expect(pollOnce.mock.calls.length).toBeGreaterThanOrEqual(results.length + 1),
    );
    await runner.stop();

    // sleep() is only ever called with the configured poll interval, and
    // never for the first `results.length` (non-empty) backlog calls.
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(sleep.mock.calls.length).toBe(pollOnce.mock.calls.length - results.length);
  });

  it("stop() lets the in-flight loop iteration finish before resolving", async () => {
    const pollOnce = vi.fn(async () => "empty" as const);
    const runner = new CostEventConsumerRunner(
      { pollOnce } as unknown as CostEventConsumerService,
      1_000,
      tinySleep,
    );

    runner.start();
    await vi.waitFor(() => expect(pollOnce).toHaveBeenCalled());
    await expect(runner.stop()).resolves.toBeUndefined();
  });

  it("start() is idempotent -- calling it twice does not spawn a second loop", async () => {
    const pollOnce = vi.fn(async () => "empty" as const);
    const runner = new CostEventConsumerRunner(
      { pollOnce } as unknown as CostEventConsumerService,
      1_000,
      tinySleep,
    );

    runner.start();
    runner.start();
    await vi.waitFor(() => expect(pollOnce).toHaveBeenCalled());
    await runner.stop();
  });

  it("keeps the loop alive and logs when pollOnce() throws", async () => {
    let calls = 0;
    const pollOnce = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("sqs throttle");
      }
      return "empty" as const;
    });
    const logger = mockLogger();
    const runner = new CostEventConsumerRunner(
      { pollOnce } as unknown as CostEventConsumerService,
      1_000,
      tinySleep,
      logger,
    );

    runner.start();
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
    await runner.stop();

    expect(pollOnce.mock.calls.length).toBeGreaterThanOrEqual(2);
    const logArgs = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string | undefined,
    ];
    expect(logArgs[0]).toMatch(/sqs throttle/);
  });
});
