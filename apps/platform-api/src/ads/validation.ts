import { z } from "zod";
import { AdsHttpError } from "./problem";
import type {
  AdsInput,
  AdsPagination,
  AdsRetrievalQuery,
  AdsSourcePermissions,
  AdsUploadCompleteRequest,
  AdsUploadStartRequest,
  DocumentPermissionsPatch,
} from "./types";

const prefixedIdPattern =
  /^[a-z]+_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const inputSchema: z.ZodType<AdsInput> = z.record(z.string(), z.json());

const paginationSchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

const documentPermissionsPatchSchema: z.ZodType<DocumentPermissionsPatch> = z
  .object({
    visibility: z.literal("tenant").optional(),
    shared_with: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one permission field must be provided",
  });

const sourcePermissionsSchema: z.ZodType<AdsSourcePermissions> = z
  .object({
    visibility: z.literal("tenant"),
    shared_with: z.array(z.string().min(1)),
    retention_days: z.number().int().min(1).max(3650).nullable().optional(),
  })
  .strict();

const retrievalQuerySchema: z.ZodType<AdsRetrievalQuery> = z
  .object({
    query: z
      .string()
      .min(1)
      .max(8_000)
      .refine((value) => value.trim().length > 0, "Query cannot be blank"),
    top_k: z.number().int().min(1).max(50).optional(),
    rerank: z.boolean().optional(),
    scope_ids: z.array(z.string().min(1)).optional(),
    source_ids: z.array(z.string().min(1)).optional(),
    project_id: z.string().min(1).nullable().optional(),
    workflow_id: z.string().min(1).nullable().optional(),
    metadata_filter: z.record(z.string(), z.json()).optional(),
  })
  .strict();

const uploadStartSchema: z.ZodType<AdsUploadStartRequest> = z
  .object({
    source_id: z.string().min(1),
    content_type: z.string().min(1).max(255),
    filename: z.string().min(1).max(512).optional(),
  })
  .strict();

const uploadCompleteSchema: z.ZodType<AdsUploadCompleteRequest> = z
  .object({
    ingestion_job_id: z.string().min(1),
    source_id: z.string().min(1),
    upload_key: z.string().min(1),
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

export function parseDocumentPermissionsPatch(
  value: unknown,
  instance: string,
): DocumentPermissionsPatch {
  return parse(documentPermissionsPatchSchema, value, instance);
}

export function parseSourcePermissions(
  value: unknown,
  instance: string,
): AdsSourcePermissions {
  return parse(sourcePermissionsSchema, value, instance);
}

export function parseAdsRetrievalQuery(
  value: unknown,
  instance: string,
): AdsRetrievalQuery {
  return parse(retrievalQuerySchema, value, instance);
}

export function parseAdsUploadStart(
  value: unknown,
  instance: string,
): AdsUploadStartRequest {
  return parse(uploadStartSchema, value, instance);
}

export function parseAdsUploadComplete(
  value: unknown,
  instance: string,
): AdsUploadCompleteRequest {
  return parse(uploadCompleteSchema, value, instance);
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
