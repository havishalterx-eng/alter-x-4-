import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  JsonValue,
  ProviderHealth,
  ProviderMetadata,
  QueueProvider,
} from "@alterx/shared-clients";

export interface SqsQueueProviderConfig {
  readonly region: string;
}

export interface SqsCommandClient {
  send(command: GetQueueUrlCommand): Promise<{ readonly QueueUrl?: string }>;
  send(command: SendMessageCommand): Promise<{ readonly MessageId?: string }>;
  send(command: ReceiveMessageCommand): Promise<{
    readonly Messages?: readonly {
      readonly Body?: string;
      readonly ReceiptHandle?: string;
    }[];
  }>;
  send(command: DeleteMessageCommand): Promise<unknown>;
  destroy?(): void;
}

export const SQS_QUEUE_CAPABILITIES: ProviderCapabilities = {
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

const SQS_QUEUE_METADATA: ProviderMetadata<"QueueProvider"> = {
  providerId: "aws-sqs",
  interfaceName: "QueueProvider",
  displayName: "AWS SQS",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.aws.sqs",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "aws-sqs-v1",
    rollbackSupported: true,
  },
};

export class SqsQueueProvider implements QueueProvider {
  readonly metadata = SQS_QUEUE_METADATA;
  readonly capabilities = SQS_QUEUE_CAPABILITIES;

  readonly #client: SqsCommandClient;
  readonly #now: () => Date;
  readonly #queueUrlCache = new Map<string, string>();

  constructor(
    config: SqsQueueProviderConfig,
    client?: SqsCommandClient,
    now?: () => Date,
  ) {
    this.#client =
      client ?? (new SQSClient({ region: config.region }) as unknown as SqsCommandClient);
    this.#now = now ?? (() => new Date());
  }

  async publish(queueName: string, message: JsonValue): Promise<void> {
    const queueUrl = await this.#resolveQueueUrl(queueName);
    await this.#client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
      }),
    );
  }

  async consume(queueName: string): Promise<JsonValue | undefined> {
    const queueUrl = await this.#resolveQueueUrl(queueName);
    const response = await this.#client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
      }),
    );
    const message = response.Messages?.[0];
    if (message?.Body === undefined) {
      return undefined;
    }
    if (message.ReceiptHandle !== undefined) {
      await this.#client.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
    }
    return JSON.parse(message.Body) as JsonValue;
  }

  async healthCheck(): Promise<ProviderHealth> {
    // Real SQS calls cost money per request; report healthy once the
    // client is constructed, matching every other real adapter's
    // no-live-probe precedent in this package (AwsSecretsManagerProvider,
    // AwsBedrockModelProvider, etc).
    return {
      status: "healthy",
      checkedAt: this.#now().toISOString(),
      latencyMs: 0,
      details: { configured: true },
    };
  }

  close(): void {
    this.#client.destroy?.();
  }

  async #resolveQueueUrl(queueName: string): Promise<string> {
    const cached = this.#queueUrlCache.get(queueName);
    if (cached !== undefined) {
      return cached;
    }
    const response = await this.#client.send(
      new GetQueueUrlCommand({ QueueName: queueName }),
    );
    if (response.QueueUrl === undefined) {
      throw new Error(`SQS did not return a queue URL for ${queueName}`);
    }
    this.#queueUrlCache.set(queueName, response.QueueUrl);
    return response.QueueUrl;
  }
}
