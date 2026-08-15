import type {
  RunsCreateRunRequest,
  TriggerDispatchDetail,
} from "@alterx/contracts";
import type {
  QueueMessageConsumer,
  QueueMessageReceipt,
} from "@alterx/shared-clients";
import { parseCanonicalEventMessage } from "./canonical-event-message";

export type CanonicalEventPollResult =
  | "empty"
  | "handled"
  | "dropped_malformed"
  | "dropped_invalid"
  | "dropped_dlq_exhausted"
  | "pending_redelivery";

/**
 * INGR-7: drains the canonical-events FIFO queue and calls the real
 * orchestration RunDispatchService.CreateRun RPC per message.
 *
 * Unlike CostEventConsumerService this consumer uses the visibility-based
 * QueueMessageConsumer port: receive() leaves the message in flight, so a
 * failed CreateRun redelivers via SQS's own visibility timeout -- no
 * self-publish retry needed. The message is only deleted when it is
 * terminal: handled successfully, structurally invalid, rejected by the
 * orchestration service (INVALID_ARGUMENT/NOT_FOUND -- redelivery could
 * never succeed), or past the carried per-trigger dlq_max_receive_count.
 */
export class CanonicalEventConsumerService {
  constructor(
    private readonly queue: QueueMessageConsumer,
    private readonly queueName: string,
    private readonly dispatch: {
      createRun(request: RunsCreateRunRequest): Promise<{
        readonly run_id: string;
        readonly event_inserted: boolean;
      }>;
    },
  ) {}

  async pollOnce(): Promise<CanonicalEventPollResult> {
    const receipt = await this.queue.receive(this.queueName);
    if (receipt === undefined) {
      return "empty";
    }

    const detail = parseCanonicalEventMessage(receipt.body);
    if (detail === undefined) {
      await this.#drop(receipt);
      return "dropped_malformed";
    }

    if (receipt.approximateReceiveCount > detail.dlq_max_receive_count) {
      await this.#drop(receipt);
      return "dropped_dlq_exhausted";
    }

    try {
      await this.dispatch.createRun(toCreateRunRequest(detail));
      await this.#drop(receipt);
      return "handled";
    } catch (error: unknown) {
      if (isTerminalDispatchError(error)) {
        await this.#drop(receipt);
        return "dropped_invalid";
      }
      // Leave the message in flight: SQS redelivers it after the
      // visibility timeout. INTERNAL errors from CreateRun are transient
      // (database or Temporal hiccup), and the events insert is
      // idempotent on its key, so a redelivery is safe.
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

function toCreateRunRequest(
  detail: TriggerDispatchDetail,
): RunsCreateRunRequest {
  return {
    tenant_id: detail.tenant_id,
    workspace_id: detail.workspace_id,
    trigger_id: detail.trigger_id,
    trigger_version: detail.trigger_version,
    event_type: detail.event_type,
    schema_version: detail.schema_version,
    source: detail.source,
    idempotency_key: detail.idempotency_key,
    payload_json: JSON.stringify(detail.payload),
  };
}

/** gRPC status codes the orchestration service maps to "cannot ever succeed". */
const TERMINAL_GRPC_CODES = new Set([3, 5]); // INVALID_ARGUMENT, NOT_FOUND

function isTerminalDispatchError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "number" && TERMINAL_GRPC_CODES.has(code);
}