import type { CostHandlerClient } from "@alterx/adapters";
import type { QueueMessageConsumer, QueueMessageReceipt } from "@alterx/shared-clients";

import { parseCostEventMessage } from "./cost-event-message";

export type CostEventPollResult =
  | "empty"
  | "ingested"
  | "dropped_malformed"
  | "dropped_invalid"
  | "dropped_dlq_exhausted"
  | "pending_redelivery";

const DEFAULT_MAX_RECEIVE_COUNT = 3;

/** gRPC status codes cost-grpc-transport.ts's mapCostError maps validation
 * failures to -- redelivery could never make these succeed. */
const TERMINAL_GRPC_CODES = new Set([3, 5]); // INVALID_ARGUMENT, NOT_FOUND

/**
 * ENGINE-FIX-P3-12. Drains the cost-events queue and calls the real
 * cost-ledger-service IngestCostEvent RPC per message (OUT-4).
 *
 * Was built on QueueProvider.consume(), which deletes the message from SQS
 * on receipt before processing -- so a failed ingest had no real retry
 * mechanism except the consumer re-publishing the message onto the same
 * queue itself, unbounded: a persistently failing message (not just a
 * transient one) looped forever. A structurally malformed message was
 * silently discarded -- billing data lost with no trace.
 *
 * Rebuilt on the visibility-timeout-based QueueMessageConsumer port instead
 * -- the same one CanonicalEventConsumerService (../canonical-events) already
 * uses correctly: receive() leaves the message in flight, so a transient
 * ingest failure redelivers via SQS's own visibility timeout with no
 * self-publish needed. The message is only deleted when it's terminal:
 * ingested successfully, structurally invalid, rejected with a terminal
 * gRPC code (INVALID_ARGUMENT -- a malformed usage_json/amount_json can
 * never parse no matter how many times it's redelivered), or past
 * maxReceiveCount.
 */
export class CostEventConsumerService {
  constructor(
    private readonly queue: QueueMessageConsumer,
    private readonly queueName: string,
    private readonly costClient: CostHandlerClient,
    private readonly maxReceiveCount: number = DEFAULT_MAX_RECEIVE_COUNT,
  ) {}

  async pollOnce(): Promise<CostEventPollResult> {
    const receipt = await this.queue.receive(this.queueName);
    if (receipt === undefined) {
      return "empty";
    }

    const request = parseCostEventMessage(receipt.body);
    if (request === undefined) {
      console.error("cost-events consumer: dropping structurally malformed message", {
        receipt_handle: receipt.receiptHandle,
      });
      await this.#drop(receipt);
      return "dropped_malformed";
    }

    if (receipt.approximateReceiveCount > this.maxReceiveCount) {
      console.error("cost-events consumer: dropping message past max receive count", {
        cost_event_id: request.cost_event_id,
        receive_count: receipt.approximateReceiveCount,
        max_receive_count: this.maxReceiveCount,
      });
      await this.#drop(receipt);
      return "dropped_dlq_exhausted";
    }

    try {
      await this.costClient.ingestCostEvent(request);
      await this.#drop(receipt);
      return "ingested";
    } catch (error: unknown) {
      if (isTerminalGrpcError(error)) {
        console.error("cost-events consumer: dropping message rejected as invalid", {
          cost_event_id: request.cost_event_id,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.#drop(receipt);
        return "dropped_invalid";
      }
      // Leave the message in flight: SQS redelivers it after the
      // visibility timeout. IngestCostEvent's insert is idempotent on
      // cost_event_id, so a redelivery is safe.
      return "pending_redelivery";
    }
  }

  async #drop(receipt: QueueMessageReceipt): Promise<void> {
    try {
      await this.queue.delete(this.queueName, receipt.receiptHandle);
    } catch {
      // The message may already be gone (concurrent consumer or a
      // previous redelivery cycle); deleting is best-effort.
    }
  }
}

function isTerminalGrpcError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "number" && TERMINAL_GRPC_CODES.has(code);
}
