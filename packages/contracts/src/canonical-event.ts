import { z } from "./zod";
import {
  ArtifactIdSchema,
  ConversationIdSchema,
  EventIdSchema,
  ExternalReferenceSchema,
  IsoTimestampSchema,
  NonEmptyStringSchema,
  TenantIdSchema,
  TriggerIdSchema,
  WorkspaceIdSchema,
} from "./ids";

export const SignatureStatusSchema = z.enum([
  "verified",
  "unverified",
  "failed",
]);

export const CanonicalEventSchema = z
  .object({
    event_id: EventIdSchema,
    event_type: NonEmptyStringSchema,
    schema_version: NonEmptyStringSchema,
    tenant_id: TenantIdSchema,
    workspace_id: WorkspaceIdSchema,
    source: NonEmptyStringSchema,
    source_account_id: ExternalReferenceSchema.optional(),
    subject_id: ExternalReferenceSchema.optional(),
    conversation_id: ConversationIdSchema.optional(),
    correlation_id: EventIdSchema.optional(),
    causation_id: EventIdSchema.optional(),
    idempotency_key: NonEmptyStringSchema,
    occurred_at: IsoTimestampSchema,
    received_at: IsoTimestampSchema,
    trigger_id: TriggerIdSchema.optional(),
    trigger_version: z.number().int().positive().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    payload_reference: ArtifactIdSchema.optional(),
    signature_status: SignatureStatusSchema,
  })
  .strict()
  .refine(
    ({ payload, payload_reference }) =>
      payload !== undefined || payload_reference !== undefined,
    {
      message: "At least one of payload or payload_reference is required",
      path: ["payload"],
    },
  );

export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;
export type SignatureStatus = z.infer<typeof SignatureStatusSchema>;
