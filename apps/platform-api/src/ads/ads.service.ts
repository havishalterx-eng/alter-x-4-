import { randomBytes } from "node:crypto";
import type {
  EngineCallerContext,
  EngineClient,
  EngineRequestBody,
  EngineResponse,
} from "../engine";
import type { ActorContext } from "../rbac/types";
import { AdsHttpError } from "./problem";
import type {
  AdsInput,
  AdsPage,
  AdsPagination,
  AdsResource,
  DocumentPermissions,
  DocumentPermissionsPatch,
} from "./types";
import { parseAdsId, parseTraceparent } from "./validation";

export class AdsService {
  constructor(private readonly engine: EngineClient) {}

  createSource(
    input: AdsInput,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<AdsResource>> {
    return this.post(
      "/api/v1/ads/sources",
      input,
      actor,
      traceparent,
      idempotencyKey,
    );
  }

  syncSource(
    sourceId: string,
    input: AdsInput,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<AdsResource>> {
    const instance = `/api/v1/ads/sources/${sourceId}/actions/sync`;
    const id = parseAdsId(sourceId, "sourceId", instance);
    return this.post(
      `/api/v1/ads/sources/${encodeURIComponent(id)}/actions/sync`,
      input,
      actor,
      traceparent,
      idempotencyKey,
    );
  }

  createUpload(
    input: AdsInput,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<AdsResource>> {
    return this.post(
      "/api/v1/ads/ingestion/uploads",
      input,
      actor,
      traceparent,
      idempotencyKey,
    );
  }

  ingestionJob(
    jobId: string,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<AdsResource>> {
    const instance = `/api/v1/ads/ingestion/jobs/${jobId}`;
    const id = parseAdsId(jobId, "jobId", instance);
    return this.engine.get(
      `/api/v1/ads/ingestion/jobs/${encodeURIComponent(id)}`,
      callerContext(actor, traceparent, instance),
    );
  }

  documents(
    pagination: AdsPagination,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<AdsPage>> {
    const instance = "/api/v1/ads/documents";
    return this.engine.get(
      withPagination(instance, pagination),
      callerContext(actor, traceparent, instance),
    );
  }

  document(
    documentId: string,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<AdsResource>> {
    const instance = `/api/v1/ads/documents/${documentId}`;
    const id = parseAdsId(documentId, "documentId", instance);
    return this.engine.get(
      `/api/v1/ads/documents/${encodeURIComponent(id)}`,
      callerContext(actor, traceparent, instance),
    );
  }

  documentPermissions(
    documentId: string,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<DocumentPermissions | null>> {
    const instance = `/api/v1/ads/documents/${documentId}/permissions`;
    const id = parseAdsId(documentId, "documentId", instance);
    return this.engine.get(
      `/api/v1/ads/documents/${encodeURIComponent(id)}/permissions`,
      callerContext(actor, traceparent, instance),
    );
  }

  updateDocumentPermissions(
    documentId: string,
    input: DocumentPermissionsPatch,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<DocumentPermissions>> {
    const instance = `/api/v1/ads/documents/${documentId}/permissions`;
    const id = parseAdsId(documentId, "documentId", instance);
    return this.engine.patch(
      `/api/v1/ads/documents/${encodeURIComponent(id)}/permissions`,
      input as EngineRequestBody,
      callerContext(actor, traceparent, instance),
      { idempotencyKey, ifMatch: "*" },
    );
  }

  deleteDocument(
    documentId: string,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<AdsResource>> {
    const instance = `/api/v1/ads/documents/${documentId}`;
    const id = parseAdsId(documentId, "documentId", instance);
    return this.engine.delete(
      `/api/v1/ads/documents/${encodeURIComponent(id)}`,
      callerContext(actor, traceparent, instance),
      { idempotencyKey },
    );
  }

  createKnowledge(
    input: AdsInput,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<AdsResource>> {
    return this.post(
      "/api/v1/ads/knowledge",
      input,
      actor,
      traceparent,
      idempotencyKey,
    );
  }

  private post(
    path: `/api/v1/${string}`,
    input: AdsInput,
    actor: ActorContext,
    traceparent: string | undefined,
    idempotencyKey: string,
  ): Promise<EngineResponse<AdsResource>> {
    return this.engine.post(
      path,
      input as EngineRequestBody,
      callerContext(actor, traceparent, path),
      { idempotencyKey },
    );
  }
}

function callerContext(
  actor: ActorContext,
  traceparent: string | undefined,
  instance: string,
): EngineCallerContext {
  if (!actor.workspace_id) {
    throw new AdsHttpError(
      403,
      "ADS_WORKSPACE_REQUIRED",
      "Workspace actor context required",
      instance,
    );
  }
  return {
    userId: actor.user_id,
    tenantId: actor.tenant_id,
    workspaceId: actor.workspace_id,
    sessionId: actor.session_id,
    authTime: actor.auth_time ?? Math.floor(Date.now() / 1_000),
    roles: actor.roles,
    permissions: actor.permissions,
    traceparent: parseTraceparent(traceparent, instance) ?? newTraceparent(),
  };
}

function withPagination(
  path: `/api/v1/${string}`,
  pagination: AdsPagination,
): `/api/v1/${string}` {
  const query = new URLSearchParams();
  if (pagination.cursor) query.set("cursor", pagination.cursor);
  if (pagination.limit !== undefined) {
    query.set("limit", pagination.limit.toString());
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function newTraceparent(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}
