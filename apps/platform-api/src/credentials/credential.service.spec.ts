import { createMockAuditEventHandler, type MutableSecretsProvider } from "@alterx/shared-clients";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialRepository } from "./credential.repository";
import { CredentialService, secretReference } from "./credential.service";
import type { CredentialRecord } from "./types";

const tenantId = "018f47a5-7b2c-7d10-8f11-123456789abc";
const actorId = "018f47a5-7b2c-7d10-8f11-123456789abd";
const secret = " Use PostgreSQL\nsecret-9876";

describe("CredentialService", () => {
  let records: Map<string, CredentialRecord>;
  let values: Map<string, string>;
  let audits: string[];
  let repository: CredentialRepository;
  let provider: MutableSecretsProvider;
  let service: CredentialService;

  beforeEach(() => {
    records = new Map();
    values = new Map();
    audits = [];
    repository = {
      create: vi.fn(async (tenant, id, input, last4) => {
        const now = new Date("2026-07-26T10:00:00.000Z");
        const record: CredentialRecord = {
          tenantId: tenant,
          id,
          ...input,
          last4,
          useAuditPtr: null,
          createdAt: now,
          updatedAt: now,
        };
        records.set(id, record);
        return record;
      }),
      list: vi.fn(async () => [...records.values()]),
      find: vi.fn(async (_tenant, id) => records.get(id)),
      update: vi.fn(async (_tenant, id, input, last4) => {
        const current = records.get(id);
        if (!current) return undefined;
        const updated = {
          ...current,
          ...input,
          ...(last4 === undefined ? {} : { last4 }),
          updatedAt: new Date(current.updatedAt.getTime() + 1_000),
        };
        records.set(id, updated);
        return updated;
      }),
      delete: vi.fn(async (_tenant, id) => records.delete(id)),
      getTenantRegion: vi.fn(async () => "ap-south-1"),
      recordUse: vi.fn(async (_tenant, id, usedBy) => {
        audits.push(`${id}:${usedBy}`);
        return "audit-id";
      }),
    } as unknown as CredentialRepository;
    provider = {
      putSecret: vi.fn(async (reference, value) => {
        values.set(reference, value);
      }),
      getSecret: vi.fn(async (reference) => values.get(reference)!),
      deleteSecret: vi.fn(async (reference) => {
        values.delete(reference);
      }),
    } as unknown as MutableSecretsProvider;
    service = new CredentialService(repository, provider, createMockAuditEventHandler());
  });

  it("stores only metadata, returns masking, and preserves provider bytes", async () => {
    const response = await service.create(tenantId, {
      name: "Production DB",
      connector: "postgres",
      scope: "project:deploy",
      value: secret,
    });
    const reference = secretReference(tenantId, response.id);

    expect(values.get(reference)).toBe(secret);
    expect(repository.create).toHaveBeenCalledWith(
      tenantId,
      response.id,
      expect.objectContaining({ name: "Production DB" }),
      "9876",
    );
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(response.last4).toBe("****9876");
  });

  it("rotates only in provider, masks list/detail, and deletes both stores", async () => {
    const created = await service.create(tenantId, {
      name: "DB",
      connector: "postgres",
      scope: "deploy",
      value: secret,
    });
    const rotated = "rotated-4321";
    const updated = await service.update(tenantId, created.id, {
      name: "DB rotated",
      value: rotated,
    });
    expect(values.get(secretReference(tenantId, created.id))).toBe(rotated);
    expect(updated.last4).toBe("****4321");
    expect(JSON.stringify(await service.list(tenantId))).not.toContain(rotated);
    expect(JSON.stringify(await service.get(tenantId, created.id))).not.toContain(
      rotated,
    );
    await service.delete(tenantId, created.id);
    expect(records.has(created.id)).toBe(false);
    expect(values.has(secretReference(tenantId, created.id))).toBe(false);
  });

  it("resolves only at use, scope-checks, and writes one audit per use", async () => {
    const created = await service.create(tenantId, {
      name: "DB",
      connector: "postgres",
      scope: "deploy",
      value: secret,
    });
    await expect(
      service.resolve(tenantId, created.id, "billing", actorId),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.resolve(tenantId, created.id, "deploy", actorId),
    ).resolves.toBe(secret);
    await service.resolve(tenantId, created.id, "deploy", actorId);
    expect(audits).toHaveLength(2);
  });

  it("maps provider failures without leaking values and compensates create", async () => {
    vi.mocked(repository.create).mockRejectedValueOnce(new Error(secret));
    await expect(
      service.create(tenantId, {
        name: "DB",
        connector: "postgres",
        scope: "deploy",
        value: secret,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain(secret);
      return true;
    });
    expect(provider.deleteSecret).toHaveBeenCalledOnce();

    await expect(service.get(tenantId, crypto.randomUUID())).rejects.toMatchObject({
      status: 404,
    });
  });

  it("maps rotation, deletion, and resolution failures without secret detail", async () => {
    const created = await service.create(tenantId, {
      name: "DB",
      connector: "postgres",
      scope: "deploy",
      value: secret,
    });
    await service.update(tenantId, created.id, {
      connector: "aurora",
      scope: "migration",
    });
    expect(records.get(created.id)).toMatchObject({
      connector: "aurora",
      scope: "migration",
    });

    vi.mocked(repository.update).mockResolvedValueOnce(undefined);
    await expect(
      service.update(tenantId, created.id, { name: "raced" }),
    ).rejects.toMatchObject({ status: 404 });

    // F2 (Phase 5): a failed metadata write after the provider secret has
    // already been overwritten must restore the prior value -- otherwise
    // the provider is left holding a secret the DB has no record of, with
    // no compensation at all (putSecret overwrites in place; there is no
    // separate old/new slot the way create()'s delete-on-failure has).
    const reference = secretReference(tenantId, created.id);
    const priorValue = values.get(reference);
    vi.mocked(repository.update).mockResolvedValueOnce(undefined);
    await expect(
      service.update(tenantId, created.id, { value: "attempted-rotation" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(values.get(reference)).toBe(priorValue);

    vi.mocked(provider.putSecret).mockRejectedValueOnce(new Error(secret));
    await expect(
      service.update(tenantId, created.id, { value: "new-secret" }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain(secret);
      return true;
    });

    vi.mocked(provider.getSecret).mockRejectedValueOnce(new Error(secret));
    await expect(
      service.resolve(tenantId, created.id, "migration", actorId),
    ).rejects.toMatchObject({ status: 502 });

    vi.mocked(provider.deleteSecret).mockRejectedValueOnce(new Error(secret));
    await expect(service.delete(tenantId, created.id)).rejects.toMatchObject({
      status: 502,
    });
    vi.mocked(repository.delete).mockResolvedValueOnce(false);
    await expect(service.delete(tenantId, created.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("preserves original create failure if compensation also fails", async () => {
    vi.mocked(provider.putSecret).mockRejectedValueOnce(new Error(secret));
    vi.mocked(provider.deleteSecret).mockRejectedValueOnce(
      new Error("cleanup failed"),
    );
    await expect(
      service.create(tenantId, {
        name: "DB",
        connector: "postgres",
        scope: "deploy",
        value: secret,
      }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
