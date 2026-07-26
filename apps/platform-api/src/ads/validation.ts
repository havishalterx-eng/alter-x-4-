import { z } from "zod";
import { AdsHttpError } from "./problem";
import type { AdsInput, AdsPagination } from "./types";

const prefixedIdPattern =
  /^[a-z]+_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const inputSchema: z.ZodType<AdsInput> = z.record(z.string(), z.json());

const paginationSchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export function parseAdsInput(value: unknown, instance: string): AdsInput {
  return parse(inputSchema, value === undefined ? {} : value, instance);
}

export function parseAdsPagination(
  cursor: string | undefined,
  limit: string | undefined,
  instance: string,
): AdsPagination {
  return parse(paginationSchema, { cursor, limit }, instance);
}

export function parseAdsId(
  value: string,
  field: string,
  instance: string,
): string {
  if (!prefixedIdPattern.test(value)) {
    throw validationError(instance, [
      { field, message: `Invalid ${field}` },
    ]);
  }
  return value;
}

export function parseTraceparent(
  value: string | undefined,
  instance: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    !/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i.test(value)
  ) {
    throw validationError(instance, [
      { field: "traceparent", message: "Invalid traceparent" },
    ]);
  }
  return value;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, instance: string): T {
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

function validationError(
  instance: string,
  fieldErrors: Array<{ field: string; message: string }>,
): AdsHttpError {
  return new AdsHttpError(
    400,
    "ADS_VALIDATION_FAILED",
    "ADS request validation failed",
    instance,
    fieldErrors,
  );
}
