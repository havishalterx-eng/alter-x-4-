import { z } from "./zod";
import { NonEmptyStringSchema } from "./ids";

export const ModelAliasSchema = z.enum([
  "FAST",
  "STANDARD",
  "ADVANCED",
  "CEILING",
]);

export const FallbackProviderSchema = z.enum(["anthropic", "openai"]);

export const FallbackBindingSchema = z
  .object({
    provider: FallbackProviderSchema,
    model_id: NonEmptyStringSchema,
  })
  .strict();

export const ModelAliasBindingSchema = z
  .object({
    model_id: NonEmptyStringSchema,
    capability_tags: z.array(NonEmptyStringSchema),
    // Ordered: gateway tries these, in order, only after the primary
    // (Bedrock) model_id fails. Config-time curated -- the policy author
    // is responsible for only listing providers that satisfy
    // capability_tags for this alias, not a runtime negotiation.
    fallback_chain: z.array(FallbackBindingSchema).optional(),
  })
  .strict();

export const ToolPermissionBindingSchema = z
  .object({
    allowed: z.boolean(),
    rate_limit_per_minute: z.number().int().positive(),
    required_scopes: z.array(NonEmptyStringSchema),
  })
  .strict();

export const CostLimitBindingSchema = z
  .object({
    max_tokens_per_call: z.number().int().positive(),
    max_cost_usd_per_call: z.number().positive(),
  })
  .strict();

export const ModelAliasPolicySchema = z
  .object({
    version: NonEmptyStringSchema,
    bindings: z
      .object({
        FAST: ModelAliasBindingSchema,
        STANDARD: ModelAliasBindingSchema,
        ADVANCED: ModelAliasBindingSchema,
        CEILING: ModelAliasBindingSchema,
      })
      .strict(),
    tool_permissions: z
      .record(NonEmptyStringSchema, ToolPermissionBindingSchema)
      .optional(),
    // Keyed by tenant_id, with "*" as the global fallback when no
    // tenant-specific limit is configured. Per-call, not per-tenant-total --
    // aggregate spend tracking lives in the Cost Ledger (Output phase).
    cost_limits: z.record(NonEmptyStringSchema, CostLimitBindingSchema).optional(),
  })
  .strict();

export type ModelAlias = z.infer<typeof ModelAliasSchema>;
export type FallbackProvider = z.infer<typeof FallbackProviderSchema>;
export type FallbackBinding = z.infer<typeof FallbackBindingSchema>;
export type ModelAliasBinding = z.infer<typeof ModelAliasBindingSchema>;
export type ToolPermissionPolicyBinding = z.infer<
  typeof ToolPermissionBindingSchema
>;
export type CostLimitPolicyBinding = z.infer<typeof CostLimitBindingSchema>;
export type ModelAliasPolicy = z.infer<typeof ModelAliasPolicySchema>;
