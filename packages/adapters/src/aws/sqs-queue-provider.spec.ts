import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { describe, expect, it, vi } from "vitest";

import { SqsQueueProvider, type SqsCommandClient } from "./sqs-queue-provider";

const FIXED_CHECKED_AT = "2026-07-25T00:00:00.000Z";

function baseConfig() {
  return { region: "ap-south-1" };
}

describe("SqsQueueProvider", () => {
  it("resolves the queue URL once then publishes a JSON-serialized message", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetQueueUrlCommand) {
        expect(command.input.QueueName).toBe("alter-dev-cost-events");
        return { QueueUrl: "https://sqs.ap-south-1.amazonaws.com/123/alter-dev-cost-events" };
      }
      if (command instanceof SendMessageCommand) {
        expect(command.input.QueueUrl).toBe(
          "https://sqs.ap-south-1.amazonaws.com/123/alter-dev-cost-events",
        );
        expect(command.input.MessageBody).toBe(JSON.stringify({ hello: "world" }));
        return { MessageId: "msg-1" };
      }
      throw new Error(`unexpected command: ${String(command)}`);
    });
    const provider = new SqsQueueProvider(baseConfig(), {
      send,
    } as unknown as SqsCommandClient);

    await provider.publish("alter-dev-cost-events", { hello: "world" });
    await provider.publish("alter-dev-cost-events", { hello: "world" });

    const getQueueUrlCalls = send.mock.calls.filter(
      ([command]) => command instanceof GetQueueUrlCommand,
    );
    expect(getQueueUrlCalls).toHaveLength(1);
  });

  it("receives and deletes a single message, returning it parsed", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetQueueUrlCommand) {
        return { QueueUrl: "https://sqs.ap-south-1.amazonaws.com/123/q" };
      }
      if (command instanceof ReceiveMessageCommand) {
        expect(command.input.MaxNumberOfMessages).toBe(1);
        return {
          Messages: [
            {
              Body: JSON.stringify({ event: "cost" }),
              ReceiptHandle: "receipt-1",
            },
          ],
        };
      }
      if (command instanceof DeleteMessageCommand) {
        expect(command.input.ReceiptHandle).toBe("receipt-1");
        return {};
      }
      throw new Error(`unexpected command: ${String(command)}`);
    });
    const provider = new SqsQueueProvider(baseConfig(), {
      send,
    } as unknown as SqsCommandClient);

    await expect(provider.consume("q")).resolves.toEqual({ event: "cost" });
  });

  it("returns undefined without deleting anything when the queue is empty", async () => {
    const deleteCalls = vi.fn();
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetQueueUrlCommand) {
        return { QueueUrl: "https://sqs.ap-south-1.amazonaws.com/123/q" };
      }
      if (command instanceof ReceiveMessageCommand) {
        return { Messages: [] };
      }
      if (command instanceof DeleteMessageCommand) {
        deleteCalls();
      }
      return {};
    });
    const provider = new SqsQueueProvider(baseConfig(), {
      send,
    } as unknown as SqsCommandClient);

    await expect(provider.consume("q")).resolves.toBeUndefined();
    expect(deleteCalls).not.toHaveBeenCalled();
  });

  it("throws when SQS returns no queue URL for the given name", async () => {
    const send = vi.fn(async () => ({}));
    const provider = new SqsQueueProvider(baseConfig(), {
      send,
    } as unknown as SqsCommandClient);

    await expect(provider.publish("missing-queue", {})).rejects.toThrow(
      /did not return a queue URL/,
    );
  });

  it("reports healthy without making a real SQS call", async () => {
    const send = vi.fn();
    const provider = new SqsQueueProvider(
      baseConfig(),
      { send } as unknown as SqsCommandClient,
      () => new Date(FIXED_CHECKED_AT),
    );

    await expect(provider.healthCheck()).resolves.toEqual({
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: { configured: true },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("publish -> consume round-trips an intact message end to end against a fake queue", async () => {
    const store = new Map<string, { Body: string; ReceiptHandle: string }[]>();
    let receiptCounter = 0;
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetQueueUrlCommand) {
        return { QueueUrl: `https://sqs.ap-south-1.amazonaws.com/123/${command.input.QueueName}` };
      }
      if (command instanceof SendMessageCommand) {
        const queueName = command.input.QueueUrl?.split("/").pop() ?? "";
        const queued = store.get(queueName) ?? [];
        receiptCounter += 1;
        queued.push({
          Body: command.input.MessageBody ?? "",
          ReceiptHandle: `receipt-${receiptCounter}`,
        });
        store.set(queueName, queued);
        return { MessageId: `msg-${receiptCounter}` };
      }
      if (command instanceof ReceiveMessageCommand) {
        const queueName = command.input.QueueUrl?.split("/").pop() ?? "";
        const queued = store.get(queueName) ?? [];
        return { Messages: queued.length > 0 ? [queued[0]] : [] };
      }
      if (command instanceof DeleteMessageCommand) {
        const queueName = command.input.QueueUrl?.split("/").pop() ?? "";
        const queued = store.get(queueName) ?? [];
        store.set(
          queueName,
          queued.filter((m) => m.ReceiptHandle !== command.input.ReceiptHandle),
        );
        return {};
      }
      throw new Error(`unexpected command: ${String(command)}`);
    });
    const provider = new SqsQueueProvider(baseConfig(), {
      send,
    } as unknown as SqsCommandClient);

    const queueName = "alter-dev-cost-events";
    const event = { tenant_id: "ten_1", cost_event_id: "cst_1" };
    await provider.publish(queueName, event);
    await expect(provider.consume(queueName)).resolves.toEqual(event);
    await expect(provider.consume(queueName)).resolves.toBeUndefined();
  });
});
