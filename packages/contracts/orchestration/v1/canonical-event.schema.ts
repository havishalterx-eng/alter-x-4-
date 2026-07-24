import { z } from "zod";

export const CanonicalEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(),
  schema_version: z.string(),
  tenant_id: z.string(),
  workspace_id: z.string(),
  source: z.string(),
  source_account_id: z.string().nullable(),
  subject_id: z.string().nullable(),
  conversation_id: z.string().nullable(),
  correlation_id: z.string(),
  causation_id: z.string().nullable(),
  idempotency_key: z.string(),
  occurred_at: z.string().datetime(),
  received_at: z.string().datetime(),
  trigger_id: z.string().nullable(),
  trigger_version: z.number().int().nullable(),
  payload: z.record(z.string(), z.unknown()),
  payload_reference: z.string().nullable(),
  signature_status: z.enum([
    "verified",
    "failed",
    "not_applicable",
    "pending",
  ]),
});
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;
