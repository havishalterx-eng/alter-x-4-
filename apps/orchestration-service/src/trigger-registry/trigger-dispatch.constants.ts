/**
 * INGR-7: the wire facts a cron fire carries. Shared by the registry
 * (which writes these into Temporal Schedule inputs) and the dispatch
 * service (which records the resulting event). The EventBridge canonical
 * rule matches the `alter.` source prefix.
 */
export const TRIGGER_DISPATCH_WORKFLOW_TYPE = "triggerDispatchWorkflow";

export const TRIGGER_CRON_FIRE_SOURCE = "alter.trigger.cron_fire";
export const TRIGGER_CRON_FIRE_DETAIL_TYPE = "trigger.cron_fire";
export const TRIGGER_CRON_FIRE_EVENT_TYPE = "trigger.cron_fire";
export const TRIGGER_DISPATCH_SCHEMA_VERSION = "v1";

/** One Temporal Schedule per cron trigger; stable id, upsert replaces. */
export function triggerScheduleId(tenantId: string, triggerId: string): string {
  return `alter-trigger-${tenantId}-${triggerId}`;
}