import { z } from "./zod";
import {
  NonEmptyStringSchema,
  TenantIdSchema,
  TriggerIdSchema,
  WorkspaceIdSchema,
} from "./ids";

/**
 * INGR-7: the payload EventBridge carries from the trigger dispatch path
 * (webhook delivery or cron fire) into the canonical-events FIFO queue.
 * This is the SQS message contract the background-workers consumer
 * validates before calling RunDispatchService.CreateRun -- it is NOT the
 * stored `events` row (the orchestration service derives that row from
 * this detail plus the trigger's dispatch-time state).
 */
export const TriggerDispatchDetailSchema = z
  .object({
    source: NonEmptyStringSchema,
    detail_type: z.enum(["trigger.delivered", "trigger.cron_fire"]),
    event_type: NonEmptyStringSchema,
    schema_version: NonEmptyStringSchema,
    tenant_id: TenantIdSchema,
    workspace_id: WorkspaceIdSchema,
    trigger_id: TriggerIdSchema,
    trigger_version: z.number().int().positive(),
    idempotency_key: NonEmptyStringSchema,
    payload: z.record(z.string(), z.unknown()),
    // Publish-time snapshot of the trigger version's dlqPolicy
    // maxReceiveCount, so the consumer can enforce the per-trigger policy
    // regardless of how the version's config changed since publish.
    dlq_max_receive_count: z.number().int().min(1).max(1000),
  })
  .strict();

export type TriggerDispatchDetail = z.infer<typeof TriggerDispatchDetailSchema>;

/**
 * What a Temporal cron Schedule carries as its workflow input: the full
 * dispatch detail minus the per-fire idempotency_key, which the workflow
 * derives deterministically from its own run id at each fire.
 */
export const TriggerDispatchScheduleInputSchema = TriggerDispatchDetailSchema.omit({
  idempotency_key: true,
});

export type TriggerDispatchScheduleInput = z.infer<
  typeof TriggerDispatchScheduleInputSchema
>;