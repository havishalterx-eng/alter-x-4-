import type { MutableSecretsProvider } from "@alterx/shared-clients";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnvVarRepository } from "./env-var.repository";
import { EnvVarService, secretReference } from "./env-var.service";
import type { EnvVarRecord } from "./types";

const tenantId = "018f47a5-7b2c-7d10-8f11-123456789abc";
const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const actorId = "usr_018f47a5-7b2c-7d10-8f11-123456789abd";
const plaintext = " Use PostgreSQL\nsecret-9876";

describe("EnvVarService", () => {
  let records: Map<string, EnvVarRecord>;
  let values: Map<string, string>;
  let audits: string[];
  let repository: EnvVarRepository;
  let provider: MutableSecretsProvider;
  let service: EnvVarService;

  beforeEach(() => {
    records = new Map();
    values = new Map();
    audits = [];
    repository = {
      create: vi.fn(async (tenant, id, project, input, last4) => {
        const now = new Date("2026-08-04T10:00:00.000Z");
        const record: EnvVarRecord = {
          tenantId: tenant,
          id,
          projectId: project,
          ...input,
          last4,
          useAuditPtr: null,
          createdAt: now,
          updatedAt: now,
        };
        records.set(id, record);
        return record;
      }),
      list: vi.fn(async (_tenant, project) =>
        [...records.values()].filter((record) => record.projectId === project),
      ),
      find: vi.fn(async (_tenant, project, id) => {
        const record = records.get(id);
        return record?.projectId === project ? record : undefined;
      }),
      update: vi.fn(async (_tenant, project, id, input, last4) => {
        const current = records.get(id);
        if (!current || current.projectId !== project) return undefined;
        const updated = {
          ...current,
          ...input,
          ...(last4 === undefined ? {} : { last4 }),
          updatedAt: new Date(current.updatedAt.getTime() + 1_000),
        };
        records.set(id, updated);
        return updated;
      }),
      delete: vi.fn(async (_tenant, project, id) => {
        const current = records.get(id);
        return current?.projectId === project && records.delete(id);
      }),
      recordUse: vi.fn(async (_tenant, id, usedBy) => {
        audits.push(`${id}:${usedBy}`);
        return "audit-id";
      }),
    } as unknown as EnvVarRepository;
    provider = {
      putSecret: vi.fn(async (reference, value) => {
        values.set(reference, value);
      }),
      getSecret: vi.fn(async (reference) => values.get(reference)!),
      deleteSecret: vi.fn(async (reference) => {
        values.delete(reference);
      }),
    } as unknown as MutableSecretsProvider;
    service = new EnvVarService(repository, provider);
  });

  it("stores metadata only, masks reads, and preserves provider bytes", async () => {
    const response = await service.create(tenantId, projectId, {
      environment: "production",
      key: "DATABASE_URL",
      value: plaintext,
    });
    const reference = secretReference(tenantId, response.id);

    expect(values.get(reference)).toBe(plaintext);
    expect(repository.create).toHaveBeenCalledWith(
      tenantId,
      response.id,
      projectId,
      { environment: "production", key: "DATABASE_URL" },
      "9876",
    );
    expect(response.last4).toBe("****9876");
    expect(JSON.stringify(response)).not.toContain(plaintext);
    expect(await service.list(tenantId, projectId)).toEqual([response]);
    expect(await service.get(tenantId, projectId, response.id)).toEqual(response);
  });

  it("rotates same provider reference and deletes both stores", async () => {
    const created = await service.create(tenantId, projectId, {
      environment: "production",
      key: "DATABASE_URL",
      value: plaintext,
    });
    const rotated = "rotated-secret-4321";
    const updated = await service.update(tenantId, projectId, created.id, {
      environment: "staging",
      key: "API_KEY",
      value: rotated,
    });
    expect(values).toEqual(
      new Map([[secretReference(tenantId, created.id), rotated]]),
    );
    expect(updated).toMatchObject({
      environment: "staging",
      key: "API_KEY",
      last4: "****4321",
    });
    expect(JSON.stringify(await service.list(tenantId, projectId))).not.toContain(
      rotated,
    );

    await service.delete(tenantId, projectId, created.id);
    expect(records.has(created.id)).toBe(false);
    expect(values.has(secretReference(tenantId, created.id))).toBe(false);
  });

  it("resolves only at point of use and writes one audit each time", async () => {
    const created = await service.create(tenantId, projectId, {
      environment: "production",
      key: "DATABASE_URL",
      value: plaintext,
    });
    await expect(
      service.resolve(tenantId, projectId, created.id, actorId),
    ).resolves.toBe(plaintext);
    await service.resolve(tenantId, projectId, created.id, actorId);
    expect(audits).toHaveLength(2);
  });

  it("maps provider and metadata failures without leaking secret detail", async () => {
    vi.mocked(repository.create).mockRejectedValueOnce(new Error(plaintext));
    await expect(
      service.create(tenantId, projectId, {
        environment: "production",
        key: "DATABASE_URL",
        value: plaintext,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain(plaintext);
      return true;
    });
    expect(provider.deleteSecret).toHaveBeenCalledOnce();

    const created = await service.create(tenantId, projectId, {
      environment: "production",
      key: "DATABASE_URL",
      value: plaintext,
    });
    vi.mocked(provider.putSecret).mockRejectedValueOnce(new Error(plaintext));
    await expect(
      service.update(tenantId, projectId, created.id, { value: "new-value" }),
    ).rejects.toMatchObject({ status: 502 });
    vi.mocked(provider.getSecret).mockRejectedValueOnce(new Error(plaintext));
    await expect(
      service.resolve(tenantId, projectId, created.id, actorId),
    ).rejects.toMatchObject({ status: 502 });
    vi.mocked(provider.deleteSecret).mockRejectedValueOnce(new Error(plaintext));
    await expect(
      service.delete(tenantId, projectId, created.id),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("maps duplicate and race outcomes honestly", async () => {
    const duplicate = Object.assign(new Error("duplicate"), { code: "23505" });
    vi.mocked(repository.create).mockRejectedValueOnce(duplicate);
    await expect(
      service.create(tenantId, projectId, {
        environment: "production",
        key: "DATABASE_URL",
        value: plaintext,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const created = await service.create(tenantId, projectId, {
      environment: "production",
      key: "DATABASE_URL",
      value: plaintext,
    });
    vi.mocked(repository.update).mockRejectedValueOnce(duplicate);
    await expect(
      service.update(tenantId, projectId, created.id, { key: "API_KEY" }),
    ).rejects.toMatchObject({ status: 409 });
    vi.mocked(repository.update).mockResolvedValueOnce(undefined);
    await expect(
      service.update(tenantId, projectId, created.id, { key: "OTHER_KEY" }),
    ).rejects.toMatchObject({ status: 404 });

    // F2 (Phase 5): same compensation gap as credentials -- a failed
    // metadata write after the provider secret has already been
    // overwritten must restore the prior value.
    const reference = secretReference(tenantId, created.id);
    const priorValue = values.get(reference);
    vi.mocked(repository.update).mockResolvedValueOnce(undefined);
    await expect(
      service.update(tenantId, projectId, created.id, { value: "attempted-rotation" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(values.get(reference)).toBe(priorValue);
    vi.mocked(repository.delete).mockResolvedValueOnce(false);
    await expect(
      service.delete(tenantId, projectId, created.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.get(tenantId, projectId, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("preserves original create failure when compensation fails", async () => {
    vi.mocked(provider.putSecret).mockRejectedValueOnce(new Error(plaintext));
    vi.mocked(provider.deleteSecret).mockRejectedValueOnce(
      new Error("cleanup failed"),
    );
    await expect(
      service.create(tenantId, projectId, {
        environment: "production",
        key: "DATABASE_URL",
        value: plaintext,
      }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
