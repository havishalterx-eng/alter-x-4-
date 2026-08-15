import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  ProviderHealth,
  ProviderMetadata,
} from "@alterx/shared-clients";

export interface EventBridgeEventPublisherConfig {
  readonly region: string;
  readonly busName: string;
  readonly endpoint?: string;
}

export interface EventBridgePublishRequest {
  readonly source: string;
  readonly detailType: string;
  readonly detail: Record<string, unknown>;
}

export interface EventBridgeCommandClient {
  send(command: PutEventsCommand): Promise<{
    readonly FailedEntryCount?: number;
  }>;
  destroy?(): void;
}

export const EVENTBRIDGE_PUBLISHER_METADATA: ProviderMetadata<"EventBusProvider"> = {
  providerId: "aws-eventbridge",
  interfaceName: "EventBusProvider",
  displayName: "AWS EventBridge",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.aws.eventbridge",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "aws-eventbridge-v1",
    rollbackSupported: true,
  },
};

export const EVENTBRIDGE_PUBLISHER_CAPABILITIES: ProviderCapabilities = {
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

export class EventBridgePublishFailedError extends Error {
  constructor(failedCount: number) {
    super(
      `EventBridge rejected ${failedCount} event(s) from PutEvents (FailedEntryCount)`,
    );
    this.name = "EventBridgePublishFailedError";
  }
}

/**
 * INGR-7: real EventBridge publisher for the canonical event path. Mirrors
 * the Terraform-declared canonical bus (alter-<env>) and rule source
 * prefix (alter.*) -- see infrastructure/terraform/modules/messaging.
 */
export class EventBridgeEventPublisher {
  readonly metadata = EVENTBRIDGE_PUBLISHER_METADATA;
  readonly capabilities = EVENTBRIDGE_PUBLISHER_CAPABILITIES;

  readonly #busName: string;
  readonly #client: EventBridgeCommandClient;

  constructor(
    config: EventBridgeEventPublisherConfig,
    client?: EventBridgeCommandClient,
  ) {
    this.#busName = config.busName;
    this.#client =
      client ??
      (new EventBridgeClient({
        region: config.region,
        ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : {}),
      }) as unknown as EventBridgeCommandClient);
  }

  async publish(request: EventBridgePublishRequest): Promise<void> {
    const response = await this.#client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.#busName,
            Source: request.source,
            DetailType: request.detailType,
            Detail: JSON.stringify(request.detail),
          },
        ],
      }),
    );
    const failed = response.FailedEntryCount ?? 0;
    if (failed > 0) {
      throw new EventBridgePublishFailedError(failed);
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    // Real EventBridge calls cost money per request; report healthy once
    // the client is constructed, matching every other real adapter's
    // no-live-probe precedent in this package.
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      details: { configured: true },
    };
  }

  close(): void {
    this.#client.destroy?.();
  }
}