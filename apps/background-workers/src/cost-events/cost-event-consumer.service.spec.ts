import { describe, expect, it, vi } from "vitest";

import type { CostHandlerClient } from "@alterx/adapters";
import type { QueueProvider } from "@alterx/shared-clients";

import { CostEventConsumerService } from "./cost-event-consumer.service";

const QUEUE_NAME = "alter-test-cost-events";

const VALID_MESSAGE = {
  tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
  cost_event_id: "cst_018f47a2-7b11-7b11-8a11-1234567890ab",
  run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
  node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
  provider_reference: "aws-bedrock",
  usage_json: "{}",
  amount_json: "{}",
  source: "model_gateway",
  occurred_at: "2026-07-31T00:00:00.000Z",
};

function fakeQueue(messages: unknown[]): { queue: QueueProvider; publish: ReturnType<typeof vi.fn> } {
  const remaining = [...messages];
  const publish = vi.fn(async () => undefined);
  return {
    publish,
    queue: {
      metadata: {} as never,
      capabilities: {} as never,
      publish,
      consume: vi.fn(async () => remaining.shift() as never),
      healthCheck: vi.fn(async () => ({ status: "healthy" as const, checkedAt: "", latencyMs: 0 })),
    },
  };
}

const noopSleep = async () => undefined;

describe("CostEventConsumerService.pollOnce", () => {
  it("reports empty when the queue has no message", async () => {
    const { queue } = fakeQueue([]);
    const costClient: CostHandlerClient = { ingestCostEvent: vi.fn(), resolveUnitPrice: vi.fn(), recordModelOutcome: vi.fn() };
    const consumer = new CostEventConsumerService(queue, QUEUE_NAME, costClient, 3, noopSleep);

    await expect(consumer.pollOnce()).resolves.toBe("empty");
  });

  it("ingests a real, well-formed message on the first try", async () => {
    const { queue } = fakeQueue([VALID_MESSAGE]);
    const ingestCostEvent = vi.fn(async () => ({ accepted: true }));
    const consumer = new CostEventConsumerService(
      queue,
      QUEUE_NAME,
      { ingestCostEvent, resolveUnitPrice: vi.fn(), recordModelOutcome: vi.fn() },
      3,
      noopSleep,
    );

    await expect(consumer.pollOnce()).resolves.toBe("ingested");
    expect(ingestCostEvent).toHaveBeenCalledWith(VALID_MESSAGE);
  });

  it("drops a structurally malformed message without retrying or requeuing", async () => {
    const { queue, publish } = fakeQueue([{ not: "a real cost event" }]);
    const ingestCostEvent = vi.fn();
    const consumer = new CostEventConsumerService(
      queue,
      QUEUE_NAME,
      { ingestCostEvent, resolveUnitPrice: vi.fn(), recordModelOutcome: vi.fn() },
      3,
      noopSleep,
    );

    await expect(consumer.pollOnce()).resolves.toBe("dropped_malformed");
    expect(ingestCostEvent).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("retries a real, well-formed message that fails to ingest, then re-publishes it after exhausting retries", async () => {
    const { queue, publish } = fakeQueue([VALID_MESSAGE]);
    const ingestCostEvent = vi.fn(async () => {
      throw new Error("cost-ledger-service unavailable");
    });
    const consumer = new CostEventConsumerService(
      queue,
      QUEUE_NAME,
      { ingestCostEvent, resolveUnitPrice: vi.fn(), recordModelOutcome: vi.fn() },
      3,
      noopSleep,
    );

    await expect(consumer.pollOnce()).resolves.toBe("requeued");
    expect(ingestCostEvent).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenCalledWith(QUEUE_NAME, VALID_MESSAGE);
  });

  it("succeeds on a later retry without requeuing", async () => {
    const { queue, publish } = fakeQueue([VALID_MESSAGE]);
    let calls = 0;
    const ingestCostEvent = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error("transient failure");
      return { accepted: true };
    });
    const consumer = new CostEventConsumerService(
      queue,
      QUEUE_NAME,
      { ingestCostEvent, resolveUnitPrice: vi.fn(), recordModelOutcome: vi.fn() },
      3,
      noopSleep,
    );

    await expect(consumer.pollOnce()).resolves.toBe("ingested");
    expect(publish).not.toHaveBeenCalled();
  });
});
