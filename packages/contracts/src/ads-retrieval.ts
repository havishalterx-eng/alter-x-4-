import {
  ChunkIdSchema,
  DocumentIdSchema,
  IsoTimestampSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  ScopeIdSchema,
  SourceIdSchema,
  WorkflowIdSchema,
} from "./ids";
import { z } from "./zod";

export const AdsRetrievalProvenanceSchema = z
  .object({
    source: z
      .object({
        id: SourceIdSchema.optional(),
        type: NonEmptyStringSchema.optional(),
        uri: z.string().url().optional(),
        title: NonEmptyStringSchema.optional(),
      })
      .passthrough()
      .optional(),
    document: z
      .object({
        id: DocumentIdSchema.optional(),
        version: z.number().int().positive().optional(),
        title: NonEmptyStringSchema.optional(),
        checksum: NonEmptyStringSchema.optional(),
      })
      .passthrough()
      .optional(),
    chunk: z
      .object({
        id: ChunkIdSchema.optional(),
        index: z.number().int().min(0).optional(),
        range: z
          .object({
            start: z.number().int().min(0),
            end: z.number().int().min(0),
          })
          .strict()
          .optional(),
      })
      .passthrough()
      .optional(),
    ingestion: z
      .object({
        job_id: NonEmptyStringSchema.optional(),
        indexed_at: IsoTimestampSchema.optional(),
        origin: NonEmptyStringSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .openapi("AdsRetrievalProvenance");

export const AdsRetrievalRequestSchema = z
  .object({
    query: NonEmptyStringSchema.max(8_000),
    top_k: z.number().int().min(1).max(50).default(10).optional(),
    rerank: z.boolean().default(true).optional(),
    scope_ids: z.array(ScopeIdSchema).optional(),
    source_ids: z.array(SourceIdSchema).optional(),
    project_id: ProjectIdSchema.nullable().optional(),
    workflow_id: WorkflowIdSchema.nullable().optional(),
    metadata_filter: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .openapi("AdsRetrievalRequest");

export const AdsRetrievalResultSchema = z
  .object({
    id: NonEmptyStringSchema,
    document_id: DocumentIdSchema,
    chunk_id: ChunkIdSchema,
    chunk_reference: NonEmptyStringSchema,
    source_id: SourceIdSchema.optional(),
    scope_id: ScopeIdSchema.optional(),
    text: NonEmptyStringSchema,
    reconstructed_text: NonEmptyStringSchema.optional(),
    score: z.number(),
    confidence: z.number().min(0).max(1),
    provenance: AdsRetrievalProvenanceSchema,
    metadata: z.record(z.string(), z.unknown()).default({}),
    freshness_at: IsoTimestampSchema.nullable().optional(),
    semantic_score: z.number().optional(),
    keyword_score: z.number().optional(),
  })
  .strict()
  .openapi("AdsRetrievalResult");

export const AdsRetrievalQueryMetadataSchema = z
  .object({
    query: NonEmptyStringSchema.max(8_000),
    top_k: z.number().int().min(1).max(50),
    rerank: z.boolean(),
    scope_ids: z.array(ScopeIdSchema),
    source_ids: z.array(SourceIdSchema),
    project_id: ProjectIdSchema.nullable().optional(),
    workflow_id: WorkflowIdSchema.nullable().optional(),
    metadata_filter: z.record(z.string(), z.unknown()),
    audited_at: IsoTimestampSchema.nullable(),
  })
  .strict()
  .openapi("AdsRetrievalQueryMetadata");

export const AdsRetrievalResponseSchema = z
  .object({
    results: z.array(AdsRetrievalResultSchema),
    query: AdsRetrievalQueryMetadataSchema,
  })
  .strict()
  .openapi("AdsRetrievalResponse");

export type AdsRetrievalRequest = z.infer<typeof AdsRetrievalRequestSchema>;
export type AdsRetrievalResult = z.infer<typeof AdsRetrievalResultSchema>;
export type AdsRetrievalResponse = z.infer<typeof AdsRetrievalResponseSchema>;
