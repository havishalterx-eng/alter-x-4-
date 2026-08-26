import { describe, expect, it, vi } from "vitest";
import { createMockObjectStorageProvider, type ObjectStorageProvider } from "@alterx/shared-clients";
import { ArtifactNotFoundError, ArtifactsService, type ArtifactTenantStore } from "./artifacts.service";

const TENANT_A = "ten_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "ten_018f4d6e-bbbb-7bbb-8bbb-bbbbbbbbbbbb";
const TENANT_A_BARE = TENANT_A.slice("ten_".length);
const RUN_A = "run_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaab";
const ARTIFACT_A = "art_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaac";
const WORKSPACE_A = "018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaad";

type FakeArtifactRow = {
  id: string;
  tenant_id: string;
  run_id: string;
  storage_reference: string;
  content_type: string;
  size_bytes: string;
  created_at: string;
  workspace_id: string;
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
            workspace_id: WORKSPACE_A,
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
  it("writes tenant-scoped bytes, persists metadata, and reads the same bytes", async () => {
    let inserted: FakeArtifactRow | undefined;
    const writableStore: ArtifactTenantStore = {
      async withTenant(tenantId, operation) {
        return operation({
          async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
            statement: string,
            values: readonly unknown[] = [],
          ) {
            if (statement.includes("INSERT INTO artifacts")) {
              const [id, tenant, runId, storageReference, contentType, sizeBytes] = values as [string, string, string, string, string, number];
              inserted = { id, tenant_id: tenant, run_id: runId, storage_reference: storageReference, content_type: contentType, size_bytes: String(sizeBytes), created_at: "2026-08-04T00:00:00Z", workspace_id: WORKSPACE_A };
              return { rowCount: 1, rows: [inserted] as unknown as readonly TRow[] };
            }
            const row = inserted?.tenant_id === tenantId ? inserted : undefined;
            return { rowCount: row === undefined ? 0 : 1, rows: row === undefined ? [] : [row] as unknown as readonly TRow[] };
          },
        });
      },
    };
    const service = new ArtifactsService(writableStore, createMockObjectStorageProvider(), "artifact-bucket");
    const bytes = new TextEncoder().encode("generated project file");

    const artifact = await service.create(TENANT_A, { runId: RUN_A, contentType: "text/plain", bytes });

    expect(artifact.id).toMatch(/^art_/);
    expect(inserted?.storage_reference).toMatch(new RegExp(`^s3://artifact-bucket/tenants/${TENANT_A_BARE}/runs/${RUN_A}/artifacts/art_`));
    await expect(service.read(TENANT_A, artifact.id)).resolves.toEqual(bytes);
  });

  it("deletes the object when its artifact row cannot be persisted", async () => {
    const objects = createMockObjectStorageProvider();
    const failingStore: ArtifactTenantStore = {
      async withTenant(_tenantId, operation) {
        return operation({
          async query<TRow extends Record<string, unknown> = Record<string, unknown>>() {
            return { rowCount: 0, rows: [] as readonly TRow[] };
          },
        });
      },
    };
    const service = new ArtifactsService(failingStore, objects, "artifact-bucket");

    await expect(service.create(TENANT_A, {
      runId: RUN_A,
      contentType: "text/plain",
      bytes: new TextEncoder().encode("rollback"),
    })).rejects.toThrow("artifact insert returned no row");
    expect(objects.deletedReferences).toHaveLength(1);
  });

  it("lists only the tenant's real artifact metadata", async () => {
    const service = new ArtifactsService(store(), createMockObjectStorageProvider(), "artifact-bucket");
    await expect(service.list(TENANT_A, RUN_A)).resolves.toEqual([
      { id: ARTIFACT_A, runId: RUN_A, workspaceId: WORKSPACE_A, contentType: "text/plain", sizeBytes: 12, createdAt: "2026-08-04T00:00:00Z" },
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
      putObject: (reference, body, contentType) =>
        base.putObject(reference, body, contentType),
      getObject: (reference) => base.getObject(reference),
      deleteObject: (reference) => base.deleteObject(reference),
      objectExists: (reference) => base.objectExists(reference),
      createPresignedDownloadUrl: sign,
    };
    const service = new ArtifactsService(store(), objects, "artifact-bucket");
    await expect(service.download(TENANT_B, ARTIFACT_A)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    expect(sign).not.toHaveBeenCalled();
  });

  it("returns a time-limited download handoff only after finding the artifact", async () => {
    const service = new ArtifactsService(store(), createMockObjectStorageProvider(), "artifact-bucket");
    const handoff = await service.download(TENANT_A, ARTIFACT_A);
    expect(handoff.signed_url).toContain("https://object-storage.invalid/download");
    expect(Date.parse(handoff.expires_at)).toBeGreaterThan(Date.now());
  });
});
