import {
  ApplicationFailure,
  proxyActivities,
  workflowInfo,
} from "@temporalio/workflow";

import {
  TriggerDispatchScheduleInputSchema,
  type TriggerDispatchScheduleInput,
} from "@alterx/contracts";

import type { TriggerDispatchActivities } from "../activities/trigger-dispatch-activities";

const TRIGGER_DISPATCH_WORKFLOW_ERROR_TYPE = "TriggerDispatchWorkflowValidationError";

/**
 * INGR-7: one Temporal Schedule Action per cron trigger. Each fire starts
 * this workflow (no fixed workflowId on the schedule action, so every fire
 * is an independent execution); the workflow derives the per-fire
 * idempotency key from its own run id -- deterministic across replay, so
 * the canonical-events consumer can dedupe a redelivered message against
 * the events table's unique (tenant_id, idempotency_key) index.
 */
export async function triggerDispatchWorkflow(
  input: TriggerDispatchScheduleInput,
): Promise<void> {
  const parsed = TriggerDispatchScheduleInputSchema.safeParse(input);
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      `triggerDispatchWorkflow input failed validation: ${parsed.error.message}`,
      TRIGGER_DISPATCH_WORKFLOW_ERROR_TYPE,
    );
  }
  await publishTriggerDispatchEvent({
    ...parsed.data,
    idempotency_key: `cron:${parsed.data.trigger_id}:${parsed.data.trigger_version}:${workflowInfo().runId}`,
  });
}

const { publishTriggerDispatchEvent } = proxyActivities<TriggerDispatchActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    maximumAttempts: 3,
  },
});