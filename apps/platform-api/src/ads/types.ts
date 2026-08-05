import type { JsonValue } from "@alterx/shared-clients";
import type {
  AdsIngestionJob,
  AdsRetrievalRequest,
  AdsRetrievalResponse,
  AdsSourcePermissions,
  AdsUploadCompleteRequest,
  AdsUploadStartRequest,
  AdsUploadStartResponse,
} from "@alterx/contracts";

export type AdsResource = Readonly<Record<string, JsonValue>>;
export type AdsInput = Record<string, JsonValue>;

export interface AdsPage {
  data: AdsResource[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

export interface AdsPagination {
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface DocumentPermissions {
  visibility: "tenant";
  shared_with: string[];
}

export interface DocumentPermissionsPatch {
  visibility?: "tenant" | undefined;
  shared_with?: string[] | undefined;
}

export type AdsRetrievalQuery = AdsRetrievalRequest;
export type {
  AdsIngestionJob,
  AdsRetrievalResponse,
  AdsSourcePermissions,
  AdsUploadCompleteRequest,
  AdsUploadStartRequest,
  AdsUploadStartResponse,
};

export interface AdsCorePresignUploadResponse {
  ingestion_job_id: string;
  upload_url: string;
  upload_fields: Record<string, string>;
  upload_key: string;
  max_content_bytes: number;
  expires_at: string;
}

export interface AdsCoreIngestionError {
  code: string;
  detail: string;
}

export interface AdsCoreIngestionJob {
  ingestion_job_id: string;
  source_id: string;
  stage:
    | "received"
    | "validated"
    | "scanned"
    | "normalized"
    | "deduplicated"
    | "chunked"
    | "indexed"
    | "failed";
  stats: Record<string, JsonValue>;
  error: AdsCoreIngestionError | null;
  created_at: string;
  completed_at: string | null;
}

export interface AdsCoreRetrievalHit {
  document_id: string;
  chunk_id: string;
  source_id: string;
  scope_id: string;
  context: string;
  reconstructed_context: string;
  score: number;
  confidence: number;
  provenance: Record<string, JsonValue>;
  freshness_at: string | null;
  metadata: Record<string, JsonValue>;
  semantic_score: number;
  keyword_score: number;
}

export interface AdsCoreRetrievalResponse {
  hits: AdsCoreRetrievalHit[];
  audited_at: string | null;
}

export const adsDeferredCapabilities = [] as const;
