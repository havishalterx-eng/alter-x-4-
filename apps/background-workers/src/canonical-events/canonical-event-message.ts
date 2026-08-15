import {
  TriggerDispatchDetailSchema,
  type TriggerDispatchDetail,
} from "@alterx/contracts";
import type { JsonValue } from "@alterx/shared-clients";

/**
 * The canonical-events queue message is an EventBridge event envelope
 * (EventBridge puts the event, not the detail, as the FIFO message body):
 *
 *   { "version": "0", "source": "alter.trigger.delivered", ...,
 *     "detail-type": "trigger.delivered", "detail": { ...dispatch detail... } }
 *
 * The envelope is untrusted at this boundary, so only `detail` is unwrapped
 * and then validated against the full schema. This tells "malformed" apart
 * from "CreateRun itself failed", so a structurally-invalid message is
 * dropped instead of redelivered forever.
 */
export function parseCanonicalEventMessage(
  raw: JsonValue,
): TriggerDispatchDetail | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const envelope = raw as Record<string, unknown>;
  if (typeof envelope.detail !== "object" || envelope.detail === null) {
    return undefined;
  }
  const parsed = TriggerDispatchDetailSchema.safeParse(envelope.detail);
  return parsed.success ? parsed.data : undefined;
}