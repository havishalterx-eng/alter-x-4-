import { z } from "./zod";
import {
  NonEmptyStringSchema,
  RequestIdSchema,
  TraceIdSchema,
} from "./ids";

export const FieldErrorSchema = z
  .object({
    field: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
  })
  .strict();

export const ProblemDetailsSchema = z
  .object({
    type: z.string().url(),
    title: NonEmptyStringSchema,
    status: z.number().int().min(100).max(599),
    detail: NonEmptyStringSchema,
    instance: z.string().startsWith("/"),
    error_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    trace_id: TraceIdSchema,
    request_id: RequestIdSchema,
    retryable: z.boolean(),
    field_errors: z.array(FieldErrorSchema),
    documentation_key: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  })
  .strict()
  .describe(
    "RFC 9457 application/problem+json. Forbidden: tenant_id, stack traces, SQL errors, provider secrets, internal service names, and raw model/provider responses.",
  );

export type FieldError = z.infer<typeof FieldErrorSchema>;
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
