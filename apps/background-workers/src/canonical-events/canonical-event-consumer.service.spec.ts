import { describe, expect, it, vi } from "vitest";

import type { RunsCreateRunRequest } from "@alterx/contracts";
import type { QueueMessageConsumer } from "@alterx/shared-clients";

import { CanonicalEventConsumerService } from "./canonical-event-consumer.service";

const QUEUE_NAME = "alter-test-events";

const VALID_DETAIL = {
  source: "alter.trigger.delivered",
  detail_type: "trigger.delivered",
  event_type: "trigger.delivered",
  schema_version: "v1",
  tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
  workspace_id: "ws_018f47a2-7b11-7b11-8a11-1234567890ab",
  trigger_id: "trg_018f47a2-7b11-7b11-8a11-1234567890ab",
  trigger_version: 1,
  idempotency_key: "sha256-abc",
  payload: { hello: "world" },
  dlq_max_receive_count: 3,
};

interface ReceiptLike {
  body: unknown;
  receiptHandle: string;
  approximateReceiveCount: number;
}

function fakeQueue(
  receipts: ReceiptLike[],
): {
  queue: QueueMessageConsumer;
  received: string[];
  deleted: string[];
} {
  const remaining = [...receipts];
  const deleted: string[] = [];
  const received: string[] = [];
  const queue: QueueMessageConsumer = {
    metadata: {
      providerId: "fake-queue",
      interfaceName: "QueueMessageConsumer",
      displayName: "fake",
      version: "test",
      telemetryNamespace: "fake.queue",
      supportsTenantOverrides: false,
      migration: { strategyVersion: "0", rollbackSupported: false },
    },
    capabilities: {
      streaming: false,
      tool_calling: false,
      vision: false,
      structured_output: false,
      long_context: false,
      regional_availability: ["ap-south-1"],
      data_residency: ["ap-south-1"],
      batch_support: false,
      maximum_payload: 262144,
      supported_languages: ["en"],
      cost_model: { rates: [] },
    },
    healthCheck: vi.fn(async () => ({
      status: "healthy" as const,
      checkedAt: "2026-08-15T00:00:00.000Z",
      latencyMs: 1,
    })),
    receive: vi.fn(async () => {
      const next = remaining.shift();
      if (next === undefined) return undefined;
      received.push(next.receiptHandle);
      return next as never;
    }),
    delete: vi.fn(async (_queueName: string, receiptHandle: string) => {
      deleted.push(receiptHandle);
    }),
  };
  return { queue, received, deleted };
}

function fakeDispatch(
  handler: (request: RunsCreateRunRequest) => Promise<unknown>,
): {
  createRun(
    request: RunsCreateRunRequest,
  ): Promise<{ readonly run_id: string; readonly event_inserted: boolean }>;
  calls: RunsCreateRunRequest[];
} {
  const calls: RunsCreateRunRequest[] = [];
  const createRun = vi.fn(
    async (
      request: RunsCreateRunRequest,
    ): Promise<{
      readonly run_id: string;
      readonly event_inserted: boolean;
    }> => {
      calls.push(request);
      return (await handler(request)) as {
        readonly run_id: string;
        readonly event_inserted: boolean;
      };
    },
  );
  return { createRun, calls };
}

function grpcError(code: number): Error {
  const error = new Error(`rpc failed with code ${code}`) as Error & {
    code: number;
  };
  error.code = code;
  return error;
}

function envelope(detail: unknown): unknown {
  return {
    version: "0",
    id: "00000000-0000-0000-0000-000000000001",
    source: "alter.trigger.delivered",
    account: "000000000000",
    time: "2026-08-15T00:00:00.000Z",
    region: "ap-south-1",
    resources: [],
    "detail-type": "trigger.delivered",
    detail,
  };
}

describe("CanonicalEventConsumerService.pollOnce", () => {
  it("reports empty when the queue has no message", async () => {
    const { queue } = fakeQueue([]);
    const consumer = new CanonicalEventConsumerService(
      queue,
      QUEUE_NAME,
      fakeDispatch(async () => ({ run_id: "run_x", event_inserted: true })),
    );
    await expect(consumer.pollOnce()).resolves.toBe("empty");
    expect(queue.receive).toHaveBeenCalledTimes(1);
  });

  it("hands a valid message to CreateRun and deletes it", async () => {
    const { queue, deleted } = fakeQueue([
      { body: envelope(VALID_DETAIL), receiptHandle: "r1", approximateReceiveCount: 1 },
    ]);
    const dispatch = fakeDispatch(async () => ({ run_id: "run_x", event_inserted: true }));
    const consumer = new CanonicalEventConsumerService(queue, QUEUE_NAME, dispatch);

    await expect(consumer.pollOnce()).resolves.toBe("handled");
    expect(dispatch.calls).toHaveLength(1);
    expect(dispatch.calls[0]).toMatchObject({
      tenant_id: VALID_DETAIL.tenant_id,
      trigger_id: VALID_DETAIL.trigger_id,
      trigger_version: 1,
      idempotency_key: "sha256-abc",
      payload_json: '{"hello":"world"}',
    });
    expect(deleted).toEqual(["r1"]);
  });

  it("drops a malformed message without calling CreateRun", async () => {
    const { queue, deleted } = fakeQueue([
      { body: { not: "a detail" }, receiptHandle: "r1", approximateReceiveCount: 1 },
    ]);
    const dispatch = fakeDispatch(async () => ({ run_id: "run_x", event_inserted: true }));
    const consumer = new CanonicalEventConsumerService(queue, QUEUE_NAME, dispatch);

    await expect(consumer.pollOnce()).resolves.toBe("dropped_malformed");
    expect(dispatch.createRun).not.toHaveBeenCalled();
    expect(deleted).toEqual(["r1"]);
  });

  it("drops a message rejected with a terminal gRPC error", async () => {
    const { queue, deleted } = fakeQueue([
      { body: envelope(VALID_DETAIL), receiptHandle: "r1", approximateReceiveCount: 1 },
    ]);
    const dispatch = fakeDispatch(async () => {
      throw grpcError(5); // NOT_FOUND
    });
    const consumer = new CanonicalEventConsumerService(queue, QUEUE_NAME, dispatch);

    await expect(consumer.pollOnce()).resolves.toBe("dropped_invalid");
    expect(deleted).toEqual(["r1"]);
  });

  it("leaves the message in flight for redelivery on an internal error", async () => {
    const { queue, deleted } = fakeQueue([
      { body: envelope(VALID_DETAIL), receiptHandle: "r1", approximateReceiveCount: 1 },
    ]);
    const dispatch = fakeDispatch(async () => {
      throw grpcError(13); // INTERNAL
    });
    const consumer = new CanonicalEventConsumerService(queue, QUEUE_NAME, dispatch);

    await expect(consumer.pollOnce()).resolves.toBe("pending_redelivery");
    expect(deleted).toHaveLength(0);
  });

  it("drops a message past the carried per-trigger receive-count policy", async () => {
    const { queue, deleted } = fakeQueue([
      { body: envelope(VALID_DETAIL), receiptHandle: "r1", approximateReceiveCount: 4 },
    ]);
    const dispatch = fakeDispatch(async () => ({ run_id: "run_x", event_inserted: true }));
    const consumer = new CanonicalEventConsumerService(queue, QUEUE_NAME, dispatch);

    await expect(consumer.pollOnce()).resolves.toBe("dropped_dlq_exhausted");
    expect(dispatch.createRun).not.toHaveBeenCalled();
    expect(deleted).toEqual(["r1"]);
  });

  it("handles a message at the per-trigger receive-count cap", async () => {
    const { queue, deleted } = fakeQueue([
      { body: envelope(VALID_DETAIL), receiptHandle: "r1", approximateReceiveCount: 3 },
    ]);
    const dispatch = fakeDispatch(async () => ({ run_id: "run_x", event_inserted: true }));
    const consumer = new CanonicalEventConsumerService(queue, QUEUE_NAME, dispatch);

    await expect(consumer.pollOnce()).resolves.toBe("handled");
    expect(deleted).toEqual(["r1"]);
  });
});
