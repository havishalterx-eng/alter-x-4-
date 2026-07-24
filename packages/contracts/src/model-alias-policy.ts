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
  })
  .strict();

export type ModelAlias = z.infer<typeof ModelAliasSchema>;
export type ModelAliasBinding = z.infer<typeof ModelAliasBindingSchema>;
export type ModelAliasPolicy = z.infer<typeof ModelAliasPolicySchema>;
