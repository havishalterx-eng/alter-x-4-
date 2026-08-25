import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { CanonicalEventConsumerRunner } from "./canonical-event-consumer-runner";
import type { CanonicalEventConsumerService } from "./canonical-event-consumer.service";

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

describe("CanonicalEventConsumerRunner", () => {
  it("keeps polling the consumer in a loop", async () => {
    const pollOnce = vi.fn(async () => "empty" as const);
    const runner = new CanonicalEventConsumerRunner(
      { pollOnce } as unknown as CanonicalEventConsumerService,
      1_000,
      tinySleep,
    );

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
    const runner = new CanonicalEventConsumerRunner(
      { pollOnce } as unknown as CanonicalEventConsumerService,
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

  it("start() is idempotent -- calling it twice does not spawn a second loop", async () => {
    const pollOnce = vi.fn(async () => "empty" as const);
    const runner = new CanonicalEventConsumerRunner(
      { pollOnce } as unknown as CanonicalEventConsumerService,
      1_000,
      tinySleep,
    );

    runner.start();
    runner.start();
    await vi.waitFor(() => expect(pollOnce).toHaveBeenCalled());
    await runner.stop();
  });
});
