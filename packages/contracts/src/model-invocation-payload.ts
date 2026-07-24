import { z } from "./zod";
import { NonEmptyStringSchema } from "./ids";

export const ModelMessageRoleSchema = z.enum(["system", "user", "assistant"]);

export const ModelMessageSchema = z
  .object({
    role: ModelMessageRoleSchema,
    content: NonEmptyStringSchema,
  })
  .strict();

export const ModelInvocationPayloadSchema = z
  .object({
    messages: z.array(ModelMessageSchema).min(1),
    max_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(1).optional(),
  })
  .strict();

export const ModelInvocationUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  })
  .strict();

export const ModelInvocationResultPayloadSchema = z
  .object({
    message: z
      .object({
        role: z.literal("assistant"),
        content: NonEmptyStringSchema,
      })
      .strict(),
    stop_reason: NonEmptyStringSchema,
  })
  .strict();

export type ModelMessageRole = z.infer<typeof ModelMessageRoleSchema>;
export type ModelMessage = z.infer<typeof ModelMessageSchema>;
export type ModelInvocationPayload = z.infer<
  typeof ModelInvocationPayloadSchema
>;
export type ModelInvocationUsage = z.infer<typeof ModelInvocationUsageSchema>;
export type ModelInvocationResultPayload = z.infer<
  typeof ModelInvocationResultPayloadSchema
>;
