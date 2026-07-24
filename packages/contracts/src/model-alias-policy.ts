import { z } from "./zod";
import { NonEmptyStringSchema } from "./ids";

export const ModelAliasSchema = z.enum([
  "FAST",
  "STANDARD",
  "ADVANCED",
  "CEILING",
]);

export const ModelAliasBindingSchema = z
  .object({
    model_id: NonEmptyStringSchema,
    capability_tags: z.array(NonEmptyStringSchema),
  })
  .strict();

export const ToolPermissionBindingSchema = z
  .object({
    allowed: z.boolean(),
    rate_limit_per_minute: z.number().int().positive(),
    required_scopes: z.array(NonEmptyStringSchema),
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
  })
  .strict();

export type ModelAlias = z.infer<typeof ModelAliasSchema>;
export type ModelAliasBinding = z.infer<typeof ModelAliasBindingSchema>;
export type ToolPermissionPolicyBinding = z.infer<
  typeof ToolPermissionBindingSchema
>;
export type ModelAliasPolicy = z.infer<typeof ModelAliasPolicySchema>;
