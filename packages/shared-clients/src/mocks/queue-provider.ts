import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  JsonValue,
  ProviderHealth,
  ProviderMetadata,
  QueueProvider,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_QUEUE_CAPABILITIES: ProviderCapabilities =
  mockCapabilities(262_144);

export interface MockQueueProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"QueueProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly health?: ProviderHealth;
  readonly publish?: (
    queueName: string,
    message: JsonValue,
  ) => Promise<void>;
  readonly consume?: (
    queueName: string,
  ) => Promise<JsonValue | undefined>;
}

export function createMockQueueProvider(
  options: MockQueueProviderOptions = {},
): QueueProvider {
  const providerId = options.providerId ?? "mock.queue";
  const messages = new Map<string, JsonValue[]>();

  return createMockProvider<QueueProvider>({
    metadata: options.metadata ?? mockMetadata(providerId, "QueueProvider"),
    capabilities: options.capabilities ?? MOCK_QUEUE_CAPABILITIES,
    ...(options.health === undefined ? {} : { health: options.health }),
    implementation: {
      publish:
        options.publish ??
        (async (queueName, message) => {
          const queued = messages.get(queueName) ?? [];
          queued.push(message);
          messages.set(queueName, queued);
        }),
      consume:
        options.consume ??
        (async (queueName) => messages.get(queueName)?.shift()),
    },
  });
}
