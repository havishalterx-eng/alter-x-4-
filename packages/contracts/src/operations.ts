import { z } from "./zod";
import { DeploymentIdSchema, IsoTimestampSchema } from "./ids";

export const PlatformTenantIdSchema = z.string().uuid();
export const StaffAccessScopeSchema = z.enum([
  "tenant:read",
  "audit:read",
  "workflows:read",
  "runs:read",
  "billing:read",
]);

export const CreateJitGrantRequestSchema = z
  .object({
    staff_user_id: z.string().regex(/^stf_[a-z0-9._:-]{1,127}$/i),
    tenant_id: PlatformTenantIdSchema,
    reason_code: z.string().trim().min(1).max(100),
    reason_text: z.string().trim().min(1).max(1_000),
    duration_minutes: z.number().int().min(1).max(480),
    scopes: z.array(StaffAccessScopeSchema).min(1).max(10),
  })
  .strict();

export const ProviderHealthStatusSchema = z.enum([
  "healthy",
  "degraded",
  "unhealthy",
]);
export const ProviderControlSchema = z
  .object({
    provider_id: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/),
    interface_name: z.string().trim().min(1).max(128),
    health: ProviderHealthStatusSchema,
    checked_at: IsoTimestampSchema,
    latency_ms: z.number().int().nonnegative(),
    active: z.boolean(),
    configuration_revision: z.string().trim().min(1).max(256),
    fallback_chain: z.array(z.string().trim().min(1).max(128)).max(10),
  })
  .strict();
export const UpdateProviderControlRequestSchema = z
  .object({
    active: z.boolean().optional(),
    fallback_chain: z
      .array(z.string().trim().min(1).max(128))
      .max(10)
      .optional(),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .refine(
    (value) => value.active !== undefined || value.fallback_chain !== undefined,
    "At least one provider control must be supplied",
  );

export const IncidentSeveritySchema = z.enum(["sev1", "sev2", "sev3"]);
export const IncidentStatusSchema = z.enum([
  "draft",
  "investigating",
  "monitoring",
  "resolved",
]);
export const IncidentPublicationStateSchema = z.enum([
  "not_requested",
  "pending_approval",
  "approved",
  "published",
  "rejected",
]);
export const CreateIncidentRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(4_000),
    severity: IncidentSeveritySchema,
    impacted_services: z.array(z.string().trim().min(1).max(128)).min(1).max(50),
  })
  .strict();
export const IncidentApprovalRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(1_000) })
  .strict();

export const RefundPaymentRequestSchema = z
  .object({
    payment_ref: z.string().trim().min(1).max(256),
    amount_minor: z.number().int().positive(),
    speed: z.enum(["normal", "optimum"]).default("normal"),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();
export const ResolveDisputeRequestSchema = z
  .object({
    action: z.enum(["accept", "contest"]),
    reason: z.string().trim().min(1).max(1_000),
    evidence_refs: z.array(z.string().trim().min(1).max(512)).max(20).default([]),
  })
  .strict();

export const AbuseSignalSchema = z
  .object({
    id: z.string().regex(/^abs_[0-9a-f-]{36}$/i),
    tenant_id: PlatformTenantIdSchema,
    signal_type: z.enum([
      "payment_fraud",
      "free_tier_velocity",
      "credential_abuse",
      "marketplace_supply_chain",
    ]),
    source: z.string().trim().min(1).max(128),
    score: z.number().min(0).max(100),
    evidence_ref: z.string().trim().min(1).max(512),
    observed_at: IsoTimestampSchema,
    status: z.enum(["open", "confirmed", "dismissed"]),
  })
  .strict();
export const ReviewAbuseSignalRequestSchema = z
  .object({
    decision: z.enum(["confirm", "dismiss"]),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const DeploymentAdminActionRequestSchema = z
  .object({
    tenant_id: PlatformTenantIdSchema,
    deployment_id: DeploymentIdSchema,
    action: z.enum(["rollback", "suspend", "resume"]),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const MarketplaceGovernanceActionRequestSchema = z
  .object({
    action: z.enum(["approve", "reject", "takedown", "restore", "set_trust"]),
    reason: z.string().trim().min(1).max(1_000),
    trust_level: z
      .enum([
        "alter_verified",
        "verified_publisher",
        "community_reviewed",
        "unverified_private",
        "blocked",
      ])
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.action === "set_trust" ? value.trust_level !== undefined : value.trust_level === undefined,
    "trust_level is required only for set_trust",
  );

export type StaffAccessScope = z.infer<typeof StaffAccessScopeSchema>;
export type CreateJitGrantRequest = z.infer<typeof CreateJitGrantRequestSchema>;
export type ProviderControl = z.infer<typeof ProviderControlSchema>;
export type UpdateProviderControlRequest = z.infer<typeof UpdateProviderControlRequestSchema>;
export type CreateIncidentRequest = z.infer<typeof CreateIncidentRequestSchema>;
export type IncidentApprovalRequest = z.infer<typeof IncidentApprovalRequestSchema>;
export type RefundPaymentRequest = z.infer<typeof RefundPaymentRequestSchema>;
export type ResolveDisputeRequest = z.infer<typeof ResolveDisputeRequestSchema>;
export type AbuseSignal = z.infer<typeof AbuseSignalSchema>;
export type ReviewAbuseSignalRequest = z.infer<typeof ReviewAbuseSignalRequestSchema>;
export type DeploymentAdminActionRequest = z.infer<typeof DeploymentAdminActionRequestSchema>;
export type MarketplaceGovernanceActionRequest = z.infer<typeof MarketplaceGovernanceActionRequestSchema>;
