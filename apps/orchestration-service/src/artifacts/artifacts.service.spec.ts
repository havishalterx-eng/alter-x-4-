import { describe, expect, it, vi } from "vitest";
import { createMockObjectStorageProvider, type ObjectStorageProvider } from "@alterx/shared-clients";
import { ArtifactNotFoundError, ArtifactsService, type ArtifactTenantStore } from "./artifacts.service";

const TENANT_A = "ten_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "ten_018f4d6e-bbbb-7bbb-8bbb-bbbbbbbbbbbb";
const TENANT_A_BARE = TENANT_A.slice("ten_".length);
const RUN_A = "run_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaab";
const ARTIFACT_A = "art_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaac";

type FakeArtifactRow = {
  id: string;
  tenant_id: string;
  run_id: string;
  storage_reference: string;
  content_type: string;
  size_bytes: string;
  created_at: string;
};

function store(): ArtifactTenantStore {
  return {
    async withTenant(tenantId, operation) {
      return operation({
        async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
          statement: string,
          values: readonly unknown[] = [],
        ) {
          const [queryTenant, id] = values as unknown as [string, string];
          if (queryTenant !== TENANT_A_BARE || (id !== RUN_A && id !== ARTIFACT_A)) {
            return { rowCount: 0, rows: [] as readonly TRow[] };
          }
          const row: FakeArtifactRow = {
            id: ARTIFACT_A,
            tenant_id: tenantId,
            run_id: RUN_A,
            storage_reference: "s3://artifact-bucket/runs/a/output.txt",
            content_type: "text/plain",
            size_bytes: "12",
            created_at: "2026-08-04T00:00:00Z",
          };
          return {
            rowCount: 1,
            rows: [row] as unknown as readonly TRow[],
          };
        },
      });
    },
  };
}

describe("ArtifactsService", () => {
  it("lists only the tenant's real artifact metadata", async () => {
    const service = new ArtifactsService(store(), createMockObjectStorageProvider());
    await expect(service.list(TENANT_A, RUN_A)).resolves.toEqual([
      { id: ARTIFACT_A, runId: RUN_A, contentType: "text/plain", sizeBytes: 12, createdAt: "2026-08-04T00:00:00Z" },
    ]);
    await expect(service.list(TENANT_B, RUN_A)).resolves.toEqual([]);
  });

  it("does not disclose another tenant's artifact or sign its object", async () => {
    const base = createMockObjectStorageProvider();
    const sign = vi.fn();
    const objects: ObjectStorageProvider = {
      metadata: base.metadata,
      capabilities: base.capabilities,
      healthCheck: () => base.healthCheck(),
      deleteObject: (reference) => base.deleteObject(reference),
      objectExists: (reference) => base.objectExists(reference),
      createPresignedDownloadUrl: sign,
    };
    const service = new ArtifactsService(store(), objects);
    await expect(service.download(TENANT_B, ARTIFACT_A)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(sign).not.toHaveBeenCalled();
  });

  it("returns a time-limited download handoff only after finding the artifact", async () => {
    const service = new ArtifactsService(store(), createMockObjectStorageProvider());
    const handoff = await service.download(TENANT_A, ARTIFACT_A);
    expect(handoff.signed_url).toContain("https://object-storage.invalid/download");
    expect(Date.parse(handoff.expires_at)).toBeGreaterThan(Date.now());
  });
});
