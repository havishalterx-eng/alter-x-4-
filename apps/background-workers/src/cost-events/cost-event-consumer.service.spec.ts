import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CostHandlerClient } from "@alterx/adapters";
import type { QueueMessageConsumer } from "@alterx/shared-clients";

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

interface ReceiptLike {
  body: unknown;
  receiptHandle: string;
  approximateReceiveCount: number;
}

function fakeQueue(receipts: ReceiptLike[]): { queue: QueueMessageConsumer; deleted: string[] } {
  const remaining = [...receipts];
  const deleted: string[] = [];
  const queue: QueueMessageConsumer = {
    metadata: {} as never,
    capabilities: {} as never,
    healthCheck: vi.fn(async () => ({ status: "healthy" as const, checkedAt: "", latencyMs: 0 })),
    receive: vi.fn(async () => remaining.shift() as never),
    delete: vi.fn(async (_queueName: string, receiptHandle: string) => {
      deleted.push(receiptHandle);
    }),
  };
  return { queue, deleted };
}

function fakeCostClient(ingestCostEvent: ReturnType<typeof vi.fn>): CostHandlerClient {
  return {
    ingestCostEvent: ingestCostEvent as CostHandlerClient["ingestCostEvent"],
    resolveUnitPrice: vi.fn(),
    recordModelOutcome: vi.fn(),
  };
}

function grpcError(code: number): Error {
  const error = new Error(`rpc failed with code ${code}`) as Error & { code: number };
  error.code = code;
  return error;
}

describe("CostEventConsumerService.pollOnce", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports empty when the queue has no message", async () => {
    const { queue } = fakeQueue([]);
    const consumer = new CostEventConsumerService(queue, QUEUE_NAME, fakeCostClient(vi.fn()));

    await expect(consumer.pollOnce()).resolves.toBe("empty");
    expect(queue.receive).toHaveBeenCalledTimes(1);
  });

  it("ingests a real, well-formed message and deletes it", async () => {
    const { queue, deleted } = fakeQueue([
      { body: VALID_MESSAGE, receiptHandle: "r1", approximateReceiveCount: 1 },
    ]);
    const ingestCostEvent = vi.fn(async () => ({ accepted: true }));
    const consumer = new CostEventConsumerService(queue, QUEUE_NAME, fakeCostClient(ingestCostEvent));

    await expect(consumer.pollOnce()).resolves.toBe("ingested");
    expect(ingestCostEvent).toHaveBeenCalledWith(VALID_MESSAGE);
    expect(deleted).toEqual(["r1"]);
  });

  it("drops a structurally malformed message without calling ingestCostEvent", async () => {
    const { queue, deleted } = fakeQueue([
      { body: { not: "a real cost event" }, receiptHandle: "r1", approximateReceiveCount: 1 },
    ]);
    const ingestCostEvent = vi.fn();
    const consumer = new CostEventConsumerService(queue, QUEUE_NAME, fakeCostClient(ingestCostEvent));

    await expect(consumer.pollOnce()).resolves.toBe("dropped_malformed");
    expect(ingestCostEvent).not.toHaveBeenCalled();
    expect(deleted).toEqual(["r1"]);
  });

  it("drops a message rejected with a terminal gRPC error (INVALID_ARGUMENT)", async () => {
    const { queue, deleted } = fakeQueue([
      { body: VALID_MESSAGE, receiptHandle: "r1", approximateReceiveCount: 1 },
    ]);
    const ingestCostEvent = vi.fn(async () => {
      throw grpcError(3); // INVALID_ARGUMENT
    });
    const consumer = new CostEventConsumerService(queue, QUEUE_NAME, fakeCostClient(ingestCostEvent));

    await expect(consumer.pollOnce()).resolves.toBe("dropped_invalid");
    expect(deleted).toEqual(["r1"]);
  });

  it("leaves the message in flight for redelivery on an internal error, not requeued or dropped", async () => {
    const { queue, deleted } = fakeQueue([
      { body: VALID_MESSAGE, receiptHandle: "r1", approximateReceiveCount: 1 },
    ]);
    const ingestCostEvent = vi.fn(async () => {
      throw grpcError(13); // INTERNAL
    });
    const consumer = new CostEventConsumerService(queue, QUEUE_NAME, fakeCostClient(ingestCostEvent));

    await expect(consumer.pollOnce()).resolves.toBe("pending_redelivery");
    expect(deleted).toHaveLength(0);
  });

  it("drops a message past maxReceiveCount instead of looping forever", async () => {
    const { queue, deleted } = fakeQueue([
      { body: VALID_MESSAGE, receiptHandle: "r1", approximateReceiveCount: 4 },
    ]);
    const ingestCostEvent = vi.fn();
    const consumer = new CostEventConsumerService(queue, QUEUE_NAME, fakeCostClient(ingestCostEvent), 3);

    await expect(consumer.pollOnce()).resolves.toBe("dropped_dlq_exhausted");
    expect(ingestCostEvent).not.toHaveBeenCalled();
    expect(deleted).toEqual(["r1"]);
  });

  it("still ingests a message at the maxReceiveCount cap, not past it", async () => {
    const { queue, deleted } = fakeQueue([
      { body: VALID_MESSAGE, receiptHandle: "r1", approximateReceiveCount: 3 },
    ]);
    const ingestCostEvent = vi.fn(async () => ({ accepted: true }));
    const consumer = new CostEventConsumerService(queue, QUEUE_NAME, fakeCostClient(ingestCostEvent), 3);

    await expect(consumer.pollOnce()).resolves.toBe("ingested");
    expect(deleted).toEqual(["r1"]);
  });
});
