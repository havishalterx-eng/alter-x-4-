import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  JsonValue,
  ProviderMetadata,
  QueueMessageConsumer,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_QUEUE_MESSAGE_CONSUMER_CAPABILITIES: ProviderCapabilities =
  mockCapabilities(262_144);

export interface MockQueueMessageConsumer extends QueueMessageConsumer {
  enqueue(queueName: string, message: JsonValue): void;
  listMessages(queueName: string): readonly JsonValue[];
}

export interface MockQueueMessageConsumerOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"QueueMessageConsumer">;
  readonly capabilities?: ProviderCapabilities;
}

export function createMockQueueMessageConsumer(
  options: MockQueueMessageConsumerOptions = {},
): MockQueueMessageConsumer {
  const providerId = options.providerId ?? "mock.queue-message-consumer";
  const messages = new Map<string, JsonValue[]>();
  let nextReceipt = 0;

  return createMockProvider<MockQueueMessageConsumer>({
    metadata:
      options.metadata ??
      mockMetadata(providerId, "QueueMessageConsumer"),
    capabilities:
      options.capabilities ?? MOCK_QUEUE_MESSAGE_CONSUMER_CAPABILITIES,
    implementation: {
      receive: async (queueName) => {
        const queued = messages.get(queueName) ?? [];
        const message = queued.shift();
        if (message === undefined) {
          return undefined;
        }
        nextReceipt += 1;
        return {
          receiptHandle: `mock-receipt-${nextReceipt}`,
          body: message,
          approximateReceiveCount: 1,
        };
      },
      delete: async (queueName, receiptHandle) => {
        void queueName;
        void receiptHandle;
      },
      enqueue: (queueName, message) => {
        const queued = messages.get(queueName) ?? [];
        queued.push(message);
        messages.set(queueName, queued);
      },
      listMessages: (queueName) =>
        Object.freeze([...(messages.get(queueName) ?? [])]),
    },
  });
}
