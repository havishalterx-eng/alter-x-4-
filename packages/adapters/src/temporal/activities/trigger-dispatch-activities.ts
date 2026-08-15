import type { TriggerDispatchDetail } from "@alterx/contracts";

import type { EventBridgeEventPublisher } from "../../aws/eventbridge-event-publisher";

export interface TriggerDispatchActivities {
  publishTriggerDispatchEvent(detail: TriggerDispatchDetail): Promise<void>;
}

/**
 * INGR-7: the only real I/O of the cron dispatch path. The workflow stays
 * activity-implementation-free (same rule as executor-workflow.ts): the
 * EventBridge PutEvents call lives here, never in workflow code.
 */
export function createTriggerDispatchActivities(
  publisher: EventBridgeEventPublisher,
): TriggerDispatchActivities {
  return {
    publishTriggerDispatchEvent: async (detail) => {
      await publisher.publish({
        source: detail.source,
        detailType: detail.detail_type,
        detail: { ...detail },
      });
    },
  };
}