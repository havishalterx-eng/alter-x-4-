import { z } from "zod";
import {
  CreateVoiceNumberBindingRequestSchema,
  InitiateVoiceCallRequestSchema,
  UpdateVoiceCallHandlingRequestSchema,
  VoiceAccountIdSchema,
} from "@alterx/contracts";
import { VoiceHttpError } from "./problem";
import type {
  CreateVoiceNumberBindingRequest,
  InitiateVoiceCallRequest,
  UpdateVoiceCallHandlingRequest,
  VoicePagination,
} from "./types";

const paginationSchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export function parseCreateVoiceNumberBinding(
  value: unknown,
  instance: string,
): CreateVoiceNumberBindingRequest {
  return parseContractSchema<CreateVoiceNumberBindingRequest>(
    CreateVoiceNumberBindingRequestSchema,
    value,
    instance,
  );
}

export function parseUpdateVoiceCallHandling(
  value: unknown,
  instance: string,
): UpdateVoiceCallHandlingRequest {
  return parseContractSchema<UpdateVoiceCallHandlingRequest>(
    UpdateVoiceCallHandlingRequestSchema,
    value,
    instance,
  );
}

export function parseInitiateVoiceCall(
  value: unknown,
  instance: string,
): InitiateVoiceCallRequest {
  return parseContractSchema<InitiateVoiceCallRequest>(
    InitiateVoiceCallRequestSchema,
    value,
    instance,
  );
}

export function parseVoicePagination(
  cursor: string | undefined,
  limit: string | undefined,
  instance: string,
): VoicePagination {
  return parse(paginationSchema, { cursor, limit }, instance);
}

export function parseVoiceAccountId(value: string, instance: string): string {
  const parsed = VoiceAccountIdSchema.safeParse(value);
  if (!parsed.success) {
    throw validationError(instance, [
      { field: "id", message: "Invalid voice account id" },
    ]);
  }
  return parsed.data;
}

export function requireIfMatch(
  value: string | undefined,
  instance: string,
): string {
  if (!value) {
    throw new VoiceHttpError(
      428,
      "IF_MATCH_REQUIRED",
      "If-Match header required",
      instance,
    );
  }
  return value;
}

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown, instance: string): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw validationError(
    instance,
    parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}

// The @alterx/contracts package resolves "zod" against a different copy of
// the library than this app's own "zod" dependency, so their ZodType
// generics are not structurally assignable. This helper duck-types
// safeParse() instead of relying on cross-package generic inference.
interface SafeParseable {
  safeParse(value: unknown): { success: true; data: unknown } | {
    success: false;
    error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> };
  };
}

function parseContractSchema<T>(
  schema: SafeParseable,
  value: unknown,
  instance: string,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data as T;
  throw validationError(
    instance,
    parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}

function validationError(
  instance: string,
  fieldErrors: Array<{ field: string; message: string }>,
): VoiceHttpError {
  return new VoiceHttpError(
    400,
    "VOICE_VALIDATION_FAILED",
    "Voice request validation failed",
    instance,
    fieldErrors,
  );
}
