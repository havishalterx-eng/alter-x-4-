import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ProviderCapabilities } from "@alterx/contracts";
import {
  createMockProvider,
  type JsonValue,
  type QueueProvider,
} from "@alterx/shared-clients";
import { describe, expect, it } from "vitest";

const QUEUE_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 262_144,
  supported_languages: [],
  cost_model: { rates: [] },
};

function createInMemoryCostQueue(): QueueProvider {
  const messages = new Map<string, string[]>();
  return createMockProvider<QueueProvider>({
    metadata: {
      providerId: "mock-cost-queue",
      interfaceName: "QueueProvider",
      displayName: "In-memory cost queue proof",
      version: "foundation-v1",
      telemetryNamespace: "alterx.adapters.aws.cost-queue-proof",
      supportsTenantOverrides: false,
      migration: {
        strategyVersion: "cost-event-queue-v1",
        rollbackSupported: true,
      },
    },
    capabilities: QUEUE_CAPABILITIES,
    implementation: {
      async publish(queueName, message): Promise<void> {
        const queued = messages.get(queueName) ?? [];
        queued.push(JSON.stringify(message));
        messages.set(queueName, queued);
      },
      async consume(queueName): Promise<JsonValue | undefined> {
        const serialized = messages.get(queueName)?.shift();
        return serialized === undefined
          ? undefined
          : (JSON.parse(serialized) as JsonValue);
      },
    },
  });
}

describe("FOUND-5 cost-event queue round trip", () => {
  it("publishes and consumes an intact cost event through QueueProvider", async () => {
    const terraform = readFileSync(
      resolve(
        process.cwd(),
        "infrastructure/terraform/modules/messaging/main.tf",
      ),
      "utf8",
    );
    expect(terraform).toContain(
      'name                       = "alter-${var.environment}-cost-events"',
    );

    const queueName = "alter-dev-cost-events";
    const event = {
      tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
      mode: "workflow",
      parent_id: "wf_018f47a2-7b11-7b11-8a11-1234567890ab",
      source: "alter.model-gateway",
      provider: "mock-model-provider",
      quantity: { unit: "tokens", value: 384 },
    } as const satisfies JsonValue;
    const queue = createInMemoryCostQueue();

    await queue.publish(queueName, event);
    await expect(queue.consume(queueName)).resolves.toEqual(event);
    await expect(queue.consume(queueName)).resolves.toBeUndefined();
    await expect(queue.healthCheck()).resolves.toMatchObject({
      status: "healthy",
    });
  });
});
