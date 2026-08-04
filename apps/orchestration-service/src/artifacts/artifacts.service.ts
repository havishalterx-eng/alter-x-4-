import { RunIdSchema, TenantIdSchema } from "@alterx/contracts";
import { randomUUID } from "node:crypto";
import type { ObjectStorageProvider } from "@alterx/shared-clients";

export class ArtifactNotFoundError extends Error {
  constructor(artifactId: string) {
    super(`Artifact ${artifactId} was not found`);
    this.name = "ArtifactNotFoundError";
  }
}

export class ArtifactValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactValidationError";
  }
}

interface TransactionLike {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rowCount: number; readonly rows: readonly TRow[] }>;
}

export interface ArtifactTenantStore {
  withTenant<T>(tenantId: string, operation: (tx: TransactionLike) => Promise<T>): Promise<T>;
}

type ArtifactRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly run_id: string;
  readonly storage_reference: string;
  readonly content_type: string;
  readonly size_bytes: string | number;
  readonly created_at: string;
};

export interface Artifact {
  readonly id: string;
  readonly runId: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface CreateArtifactInput {
  readonly runId: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

function bareTenantUuid(tenantId: string): string {
  const parsed = TenantIdSchema.safeParse(tenantId);
  if (!parsed.success) throw new ArtifactValidationError("tenantId must be a ten_ prefixed UUIDv7");
  return parsed.data.slice("ten_".length);
}

function requireValue(name: string, value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) throw new ArtifactValidationError(`${name} is required`);
  return value;
}

function newArtifactId(): string {
  const id = randomUUID();
  return `art_${id.slice(0, 14)}7${id.slice(15)}`;
}

function fromRow(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    runId: row.run_id,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
  };
}

export class ArtifactsService {
  constructor(
    private readonly store: ArtifactTenantStore,
    private readonly objects: ObjectStorageProvider,
    private readonly bucketName: string,
  ) {}

  async create(tenantId: string, input: CreateArtifactInput): Promise<Artifact> {
    const tenant = bareTenantUuid(requireValue("tenantId", tenantId));
    if (!RunIdSchema.safeParse(input.runId).success) {
      throw new ArtifactValidationError("runId must be a run_ prefixed UUIDv7");
    }
    if (input.contentType.trim().length === 0) throw new ArtifactValidationError("contentType is required");
    if (this.bucketName.trim().length === 0) throw new ArtifactValidationError("artifact bucket is required");

    const artifactId = newArtifactId();
    const storageReference = `s3://${this.bucketName}/tenants/${tenant}/runs/${input.runId}/artifacts/${artifactId}`;
    await this.objects.putObject(
      storageReference,
      Buffer.from(input.bytes),
      input.contentType,
    );
    try {
      return await this.store.withTenant(tenant, async (tx) => {
        const result = await tx.query<ArtifactRow>(
          `INSERT INTO artifacts (id, tenant_id, run_id, storage_reference, content_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, tenant_id, run_id, storage_reference, content_type, size_bytes, created_at::text`,
          [artifactId, tenant, input.runId, storageReference, input.contentType, input.bytes.byteLength],
        );
        const row = result.rows[0];
        if (row === undefined) throw new Error("artifact insert returned no row");
        return fromRow(row);
      });
    } catch (error: unknown) {
      try { await this.objects.deleteObject(storageReference); } catch { /* Preserve the database failure. */ }
      throw error;
    }
  }

  async list(tenantId: string, runId: string): Promise<readonly Artifact[]> {
    const tenant = bareTenantUuid(requireValue("tenantId", tenantId));
    const run = requireValue("runId", runId);
    return this.store.withTenant(tenant, async (tx) => {
      const result = await tx.query<ArtifactRow>(
        `SELECT id, tenant_id, run_id, storage_reference, content_type, size_bytes, created_at
         FROM artifacts WHERE tenant_id = $1 AND run_id = $2 ORDER BY created_at DESC, id DESC`,
        [tenant, run],
      );
      return result.rows.map(fromRow);
    });
  }

  async get(tenantId: string, artifactId: string): Promise<Artifact> {
    const { row } = await this.find(tenantId, artifactId);
    return fromRow(row);
  }

  async download(tenantId: string, artifactId: string): Promise<{ readonly signed_url: string; readonly expires_at: string }> {
    const { row } = await this.find(tenantId, artifactId);
    const expiresInSeconds = 900;
    const signedUrl = await this.objects.createPresignedDownloadUrl(row.storage_reference, expiresInSeconds);
    return {
      signed_url: signedUrl,
      expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async read(tenantId: string, artifactId: string): Promise<Uint8Array> {
    const { row } = await this.find(tenantId, artifactId);
    return new Uint8Array(await this.objects.getObject(row.storage_reference));
  }

  private async find(tenantId: string, artifactId: string): Promise<{ readonly row: ArtifactRow }> {
    const tenant = bareTenantUuid(requireValue("tenantId", tenantId));
    const id = requireValue("artifactId", artifactId);
    return this.store.withTenant(tenant, async (tx) => {
      const result = await tx.query<ArtifactRow>(
        `SELECT id, tenant_id, run_id, storage_reference, content_type, size_bytes, created_at
         FROM artifacts WHERE tenant_id = $1 AND id = $2`,
        [tenant, id],
      );
      const row = result.rows[0];
      if (row === undefined) throw new ArtifactNotFoundError(id);
      return { row };
    });
  }
}
