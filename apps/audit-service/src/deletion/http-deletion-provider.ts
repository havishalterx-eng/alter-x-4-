import type {
  DeletionProvider,
  DeletionResult,
  ReplayResult,
  RetentionSweepResult,
  SubjectDataLocation,
  VerificationResult,
} from "@alterx/contracts";

/** Internal-only client contract. Raw subject IDs are never part of the public provider port. */
export interface InternalDeletionStoreClient extends DeletionProvider {
  readonly store: string;
  listSubjectIds(): Promise<readonly string[]>;
}

export class HttpDeletionProvider implements InternalDeletionStoreClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    readonly store: string,
  ) {}

  locateSubjectData(tenantId: string) {
    return this.request<readonly SubjectDataLocation[]>(`/internal/deletion/locate?tenantId=${encodeURIComponent(tenantId)}`);
  }
  deleteSubjectData(tenantId: string, manifestId: string) {
    return this.request<DeletionResult>("/internal/deletion/delete", { tenantId, manifestId });
  }
  verifyDeletion(tenantId: string, manifestId: string) {
    return this.request<VerificationResult>("/internal/deletion/verify", { tenantId, manifestId });
  }
  applyRetentionPolicy() {
    return this.request<RetentionSweepResult>("/internal/deletion/retention", {});
  }
  replayDeletionLedger(sinceTimestamp: string): Promise<ReplayResult> {
    void sinceTimestamp;
    return Promise.reject(new Error("Replay is coordinated by audit-service"));
  }
  listSubjectIds() {
    return this.request<readonly string[]>("/internal/deletion/subjects");
  }

  private async request<T>(path: string, body?: object): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${this.store} deletion request failed with status ${response.status}`);
    return await response.json() as T;
  }
}
