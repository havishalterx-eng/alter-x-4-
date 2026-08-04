import type { JsonValue } from "@alterx/shared-clients";

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

export const adsDeferredCapabilities = [
  {
    capability: "upload_signed_url_job_shape",
    status: "NOT_MET",
    reason:
      "Upload returns opaque Resource; only the ingestion-job Location header is declared, so signed-URL and job-id body fields cannot be asserted by the BFF.",
  },
  {
    capability: "retrieval_testing",
    status: "NOT_MET",
    reason: "Engine contract has no ADS retrieval endpoint.",
  },
  {
    capability: "retrieval_provenance_confidence",
    status: "NOT_MET",
    reason:
      "Engine contract declares no retrieval result, provenance, or confidence shape.",
  },
  {
    capability: "retention_config",
    status: "NOT_MET",
    reason: "Engine contract has no ADS retention configuration endpoint.",
  },
  {
    capability: "source_permissions",
    status: "NOT_MET",
    reason:
      "Engine contract has no source-permission endpoint or declared permission fields.",
  },
  {
    capability: "deletion_certificate",
    status: "NOT_MET",
    reason:
      "Document deletion exists, but its opaque Resource response declares no deletion-certificate surface.",
  },
] as const;
