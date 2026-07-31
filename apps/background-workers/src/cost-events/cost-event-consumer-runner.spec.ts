import { describe, expect, it, vi } from "vitest";

import { CostEventConsumerRunner } from "./cost-event-consumer-runner";
import type { CostEventConsumerService } from "./cost-event-consumer.service";

// A real (if tiny) delay -- an instantly-resolving sleep would make the
// loop spin as fast as the CPU allows whenever pollOnce() reports "empty",
// which is exactly what production sleep() prevents. That runaway spin
// previously crashed the test worker.
const tinySleep = async () => new Promise<void>((resolve) => setTimeout(resolve, 5));

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
});
