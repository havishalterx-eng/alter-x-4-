import type { CostHandlerClient } from "@alterx/adapters";
import type { QueueProvider } from "@alterx/shared-clients";

import { parseCostEventMessage } from "./cost-event-message";

export type CostEventPollResult =
  | "empty"
  | "ingested"
  | "requeued"
  | "dropped_malformed";

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drains the cost-events queue and calls the real cost-ledger-service
 * IngestCostEvent RPC per message (OUT-4).
 *
 * IMPORTANT: this repo's QueueProvider.consume() (see SqsQueueProvider)
 * deletes the message from SQS on receipt, before the caller processes it
 * -- there is no visibility-timeout-based redelivery here, unlike typical
 * SQS consumer patterns. So on an ingestion failure this consumer re-
 * publishes the message onto the same queue itself as the only available
 * "retry later" mechanism, after a bounded number of immediate retries. A
 * message that fails structural validation (parseCostEventMessage) is
 * dropped rather than requeued -- requeuing a message that can never parse
 * would loop forever.
 */
export class CostEventConsumerService {
  constructor(
    private readonly queue: QueueProvider,
    private readonly queueName: string,
    private readonly costClient: CostHandlerClient,
    private readonly maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  async pollOnce(): Promise<CostEventPollResult> {
    const raw = await this.queue.consume(this.queueName);
    if (raw === undefined) {
      return "empty";
    }

    const request = parseCostEventMessage(raw);
    if (request === undefined) {
      return "dropped_malformed";
    }

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await this.costClient.ingestCostEvent(request);
        return "ingested";
      } catch {
        if (attempt === this.maxAttempts) {
          await this.queue.publish(this.queueName, raw);
          return "requeued";
        }
        await this.sleep(BASE_BACKOFF_MS * attempt);
      }
    }
    /* c8 ignore next */
    throw new Error("unreachable");
  }
}
