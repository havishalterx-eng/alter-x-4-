import { z } from "./zod";
import { NonEmptyStringSchema } from "./ids";

export const ProviderCostRateSchema = z
  .object({
    unit: z.enum([
      "input_token",
      "output_token",
      "request",
      "second",
      "image",
      "character",
    ]),
    currency_code: z.string().regex(/^[A-Z]{3}$/),
    amount: z.number().nonnegative(),
  })
  .strict();

export const ProviderCapabilitiesSchema = z
  .object({
    streaming: z.boolean(),
    tool_calling: z.boolean(),
    vision: z.boolean(),
    structured_output: z.boolean(),
    long_context: z.boolean(),
    regional_availability: z.array(NonEmptyStringSchema),
    data_residency: z.array(NonEmptyStringSchema),
    batch_support: z.boolean(),
    maximum_payload: z.number().int().positive(),
    supported_languages: z.array(NonEmptyStringSchema),
    cost_model: z
      .object({
        rates: z.array(ProviderCostRateSchema),
      })
      .strict(),
  })
  .strict();

export type ProviderCapabilities = z.infer<
  typeof ProviderCapabilitiesSchema
>;
