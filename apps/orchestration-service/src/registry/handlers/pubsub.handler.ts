import type { NodeType } from "@alterx/contracts";
import type { JsonValue, QueueProvider } from "@alterx/shared-clients";

import {
  NodeHandlerValidationError,
  type NodeExecutionContext,
  type NodeExecutionResult,
  type NodeHandler,
} from "../handler";

/**
 * PubSub: publishes a payload to a topic via the Alter QueueProvider
 * interface (never a vendor SDK directly -- adapter law). config.payload
 * overrides the default of publishing every upstream input verbatim.
 *
 * No real QueueProvider adapter exists yet (only the shared-clients mock);
 * wiring a production adapter (SQS/Redis-backed) is follow-up work once
 * this ticket's registry is actually consumed by a live Executor.
 */
export class PubSubHandler implements NodeHandler {
  readonly nodeType: NodeType = "PubSub";

  constructor(private readonly queueProvider: QueueProvider) {}

  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const topic = context.config["topic"];
    if (typeof topic !== "string" || topic.trim().length === 0) {
      throw new NodeHandlerValidationError(
        "PubSub requires a non-empty config.topic string",
      );
    }

    const payload = (context.config["payload"] as JsonValue | undefined) ??
      (context.inputs as unknown as JsonValue);

    await this.queueProvider.publish(topic, payload);

    return { output: { published: true, topic } };
  }
}
