import {
  DocumentIdSchema,
  IngestionJobIdSchema,
  IsoTimestampSchema,
  NonEmptyStringSchema,
  SourceIdSchema,
} from "./ids";
import { SignedReferenceSchema } from "./signed-reference";
import { z } from "./zod";

export const AdsIngestionStageSchema = z.enum([
  "received",
  "validated",
  "scanned",
  "normalized",
  "deduplicated",
  "chunked",
  "indexed",
  "failed",
]);

export const AdsIngestionStatusSchema = z.enum([
  "queued",
  "in_progress",
  "completed",
  "failed",
]);

export const AdsUploadStartRequestSchema = z
  .object({
    source_id: SourceIdSchema,
    content_type: NonEmptyStringSchema.max(255),
    filename: NonEmptyStringSchema.max(512).optional(),
  })
  .strict()
  .openapi("AdsUploadStartRequest");

export const AdsUploadStartResponseSchema = z
  .object({
    ingestion_job_id: IngestionJobIdSchema,
    upload: SignedReferenceSchema,
    upload_fields: z.record(z.string(), z.string()),
    upload_key: NonEmptyStringSchema,
    max_content_bytes: z.number().int().positive(),
  })
  .strict()
  .openapi("AdsUploadStartResponse");

export const AdsUploadCompleteRequestSchema = z
  .object({
    ingestion_job_id: IngestionJobIdSchema,
    source_id: SourceIdSchema,
    upload_key: NonEmptyStringSchema,
  })
  .strict()
  .openapi("AdsUploadCompleteRequest");

export const AdsIngestionFailureSchema = z
  .object({
    code: NonEmptyStringSchema,
    detail: NonEmptyStringSchema,
  })
  .strict()
  .openapi("AdsIngestionFailure");

export const AdsIngestionProgressSchema = z
  .object({
    completed_stages: z.number().int().min(0),
    total_stages: z.number().int().positive(),
    percent: z.number().min(0).max(100),
    current_stage: AdsIngestionStageSchema,
  })
  .strict()
  .openapi("AdsIngestionProgress");

export const AdsIngestionJobSchema = z
  .object({
    ingestion_job_id: IngestionJobIdSchema,
    source_id: SourceIdSchema,
    status: AdsIngestionStatusSchema,
    stage: AdsIngestionStageSchema,
    progress: AdsIngestionProgressSchema,
    document_ids: z.array(DocumentIdSchema),
    failure_detail: AdsIngestionFailureSchema.nullable(),
    created_at: IsoTimestampSchema,
    completed_at: IsoTimestampSchema.nullable(),
  })
  .strict()
  .openapi("AdsIngestionJob");

export type AdsUploadStartResponse = z.infer<
  typeof AdsUploadStartResponseSchema
>;
export type AdsUploadStartRequest = z.infer<typeof AdsUploadStartRequestSchema>;
export type AdsUploadCompleteRequest = z.infer<
  typeof AdsUploadCompleteRequestSchema
>;
export type AdsIngestionJob = z.infer<typeof AdsIngestionJobSchema>;
