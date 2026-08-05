// ENG-BINDING -- trigger-to-integration binding, per-integration webhook
// endpoints, and webhook signing-secret rotation.
//
// Field names are camelCase, matching trigger-registry's real wire format
// (see triggers.ts's file-level comment): orchestration-service returns these
// TS objects directly over HTTP with no key-casing transform, so this schema
// documents the format that actually goes over the wire rather than the
// snake_case used by the rest of the platform contract.
//
// ============================================================================
// DECLARED SECRET-ROTATION SEMANTICS
// ============================================================================
// Model: HARD CUTOVER. Overlap window: 0 seconds.
//
// POST /webhook-endpoints/{id}/actions/rotate-secret mints a new signing
// secret and, in the same transaction, marks the previous secret `revoked`
// and deletes its material from the SecretsProvider. From the moment the
// rotate call returns 200, a request signed with the previous secret fails
// signature verification with 401 -- there is no grace period in which both
// secrets are accepted.
//
// Verification only ever considers the endpoint's single `active` secret
// record. The `revoked` state is terminal: a revoked secret is never
// re-consulted, and its material no longer exists to be consulted with.
//
// The alternative model (a bounded overlap window where the old secret stays
// valid for a declared period, then hard-expires) is representable by this
// contract -- `WebhookSecretRotationPolicySchema` carries `model` and
// `overlapSeconds` explicitly -- but is NOT what Engine implements today.
// Callers must assert the values in WEBHOOK_SECRET_ROTATION_POLICY, not
// assume a window exists.
//
// ============================================================================
// SIGNING SCHEME
// ============================================================================
// HMAC-SHA256 over the exact bytes `${timestamp}.${rawBody}`, where
// `timestamp` is the decimal Unix-seconds value of the `x-alter-timestamp`
// request header and `rawBody` is the unparsed request body. The digest is
// sent lowercase-hex in `x-alter-signature`, prefixed `sha256=`.
// A request whose timestamp is more than `maxSkewSeconds` away from server
// time is rejected before signature comparison (replay bound).
//
// The signing secret itself is NEVER returned by any route in this contract
// and never written to the database in plaintext; it lives only behind
// SecretsProvider, addressed by the opaque reference Engine holds internally.
// `WebhookEndpointSchema` deliberately has no secret and no secretRef field.
import {
  IntegrationConnectionIdSchema,
  IsoTimestampSchema,
  NonEmptyStringSchema,
  TenantIdSchema,
  TriggerBindingIdSchema,
  TriggerIdSchema,
  WebhookEndpointIdSchema,
  WorkspaceIdSchema,
} from "./ids";
import { z } from "./zod";

export const WebhookSecretRotationModelSchema = z.enum([
  "hard_cutover",
  "overlap_window",
]);

export const WebhookSecretRotationPolicySchema = z
  .object({
    model: WebhookSecretRotationModelSchema,
    // Seconds the previous secret remains valid after a rotation. Always 0
    // under the hard_cutover model.
    overlapSeconds: z.number().int().min(0).max(86_400),
  })
  .strict();

/**
 * The rotation semantics Engine implements today, in machine-assertable form.
 * Platform tests should compare a rotate-secret response's `rotationPolicy`
 * against this object rather than hard-coding either value.
 */
export const WEBHOOK_SECRET_ROTATION_POLICY = Object.freeze({
  model: "hard_cutover",
  overlapSeconds: 0,
} as const);

export const WEBHOOK_SIGNATURE_HEADER = "x-alter-signature";
export const WEBHOOK_TIMESTAMP_HEADER = "x-alter-timestamp";
export const WEBHOOK_SIGNATURE_ALGORITHM = "hmac-sha256";
/** Bytes that are HMAC'd, in template form, for documentation and tests. */
export const WEBHOOK_SIGNATURE_PAYLOAD_TEMPLATE = "{timestamp}.{rawBody}";

export const TriggerBindingStatusSchema = z.enum(["active", "disabled"]);

/**
 * Typed binding configuration. `eventTypes` is the set of integration event
 * types this binding accepts; an inbound webhook whose event type is not
 * listed by any active binding on the endpoint is acknowledged but fans out
 * to nothing. `filter` is an optional equality map applied to the decoded
 * payload's top-level fields.
 */
export const TriggerBindingConfigSchema = z
  .object({
    eventTypes: z.array(NonEmptyStringSchema.max(200)).min(1).max(50),
    filter: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();

export const TriggerBindingSchema = z
  .object({
    id: TriggerBindingIdSchema,
    tenantId: TenantIdSchema,
    workspaceId: WorkspaceIdSchema,
    triggerId: TriggerIdSchema,
    integrationId: IntegrationConnectionIdSchema,
    webhookEndpointId: WebhookEndpointIdSchema,
    config: TriggerBindingConfigSchema,
    status: TriggerBindingStatusSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();

export const TriggerBindingListSchema = z
  .object({
    bindings: z.array(TriggerBindingSchema),
  })
  .strict();

export const CreateTriggerBindingRequestSchema = z
  .object({
    integrationId: IntegrationConnectionIdSchema,
    config: TriggerBindingConfigSchema,
  })
  .strict();

/**
 * A webhook endpoint is provisioned once per (tenant, workspace, integration)
 * and is shared by every binding onto that integration. `url` embeds a
 * 256-bit random, unguessable path token; it is the only place that token is
 * disclosed. No secret material appears here.
 */
export const WebhookEndpointSchema = z
  .object({
    id: WebhookEndpointIdSchema,
    tenantId: TenantIdSchema,
    workspaceId: WorkspaceIdSchema,
    integrationId: IntegrationConnectionIdSchema,
    url: z.string().url(),
    signatureHeader: z.literal(WEBHOOK_SIGNATURE_HEADER),
    timestampHeader: z.literal(WEBHOOK_TIMESTAMP_HEADER),
    signatureAlgorithm: z.literal(WEBHOOK_SIGNATURE_ALGORITHM),
    signaturePayloadTemplate: z.literal(WEBHOOK_SIGNATURE_PAYLOAD_TEMPLATE),
    maxSkewSeconds: z.number().int().min(30).max(900),
    activeSecretVersion: z.number().int().positive(),
    secretRotatedAt: IsoTimestampSchema.nullable(),
    rotationPolicy: WebhookSecretRotationPolicySchema,
    createdAt: IsoTimestampSchema,
  })
  .strict();

/**
 * Rotation result. Carries no secret material -- the new secret is readable
 * only through SecretsProvider by an authorised operator.
 * `previousSecretInvalidatedAt` is the instant the old secret stopped
 * verifying; under hard_cutover it equals `rotatedAt`.
 */
export const RotateWebhookSecretResultSchema = z
  .object({
    endpointId: WebhookEndpointIdSchema,
    activeSecretVersion: z.number().int().positive(),
    previousSecretVersion: z.number().int().positive().nullable(),
    previousSecretInvalidatedAt: IsoTimestampSchema.nullable(),
    rotatedAt: IsoTimestampSchema,
    rotationPolicy: WebhookSecretRotationPolicySchema,
  })
  .strict();

/** 202 body returned by the public inbound webhook receiver. */
export const WebhookDeliveryAcceptedSchema = z
  .object({
    endpointId: WebhookEndpointIdSchema,
    accepted: z.literal(true),
    matchedBindingIds: z.array(TriggerBindingIdSchema),
  })
  .strict();

export type WebhookSecretRotationModel = z.infer<
  typeof WebhookSecretRotationModelSchema
>;
export type WebhookSecretRotationPolicy = z.infer<
  typeof WebhookSecretRotationPolicySchema
>;
export type TriggerBinding = z.infer<typeof TriggerBindingSchema>;
export type TriggerBindingConfig = z.infer<typeof TriggerBindingConfigSchema>;
export type TriggerBindingStatus = z.infer<typeof TriggerBindingStatusSchema>;
export type CreateTriggerBindingRequest = z.infer<
  typeof CreateTriggerBindingRequestSchema
>;
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;
export type RotateWebhookSecretResult = z.infer<
  typeof RotateWebhookSecretResultSchema
>;
export type WebhookDeliveryAccepted = z.infer<
  typeof WebhookDeliveryAcceptedSchema
>;
