import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  maskSecretLast4,
  secretLast4,
  type MutableSecretsProvider,
} from "@alterx/shared-clients";
import { CredentialRepository } from "./credential.repository";
import { CredentialHttpError } from "./problem";
import { CREDENTIAL_AUDIT_CLIENT, CREDENTIAL_SECRETS_PROVIDER } from "./tokens";
import { assertTenantRegion } from "./region-enforcement";
import type { AuditEventHandler } from "@alterx/shared-clients";
import type {
  CreateCredentialInput,
  CredentialRecord,
  CredentialView,
  UpdateCredentialInput,
} from "./types";

@Injectable()
export class CredentialService {
  constructor(
    private readonly repository: CredentialRepository,
    @Inject(CREDENTIAL_SECRETS_PROVIDER)
    private readonly secrets: MutableSecretsProvider,
    @Inject(CREDENTIAL_AUDIT_CLIENT)
    private readonly auditClient: AuditEventHandler,
  ) {}

  async create(
    tenantId: string,
    input: CreateCredentialInput,
  ): Promise<CredentialView> {
    const id = randomUUID();
    const reference = secretReference(tenantId, id);

    const tenantRegion = await this.repository.getTenantRegion(tenantId);
    const destinationRegion = process.env.ALTER_REGION ?? process.env.AWS_REGION ?? "ap-south-1";
    await assertTenantRegion(tenantRegion, destinationRegion, this.auditClient, {
      tenantId,
      actorType: "system",
      actorRef: "platform-api",
      action: "credential.write",
      targetType: "credential",
      targetRef: id,
    });

    try {
      await this.secrets.putSecret(reference, input.value);
      const record = await this.repository.create(
        tenantId,
        id,
        {
          name: input.name,
          connector: input.connector,
          scope: input.scope,
        },
        secretLast4(input.value),
      );
      return project(record);
    } catch (error) {
      await bestEffortDelete(this.secrets, reference);
      throw providerFailure(error, "/api/v1/credentials");
    }
  }

  async list(tenantId: string): Promise<CredentialView[]> {
    return (await this.repository.list(tenantId)).map(project);
  }

  async get(
    tenantId: string,
    id: string,
    instance = `/api/v1/credentials/${id}`,
  ): Promise<CredentialView> {
    return project(await this.requireRecord(tenantId, id, instance));
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateCredentialInput,
  ): Promise<CredentialView> {
    const instance = `/api/v1/credentials/${id}`;
    await this.requireRecord(tenantId, id, instance);

    const tenantRegion = await this.repository.getTenantRegion(tenantId);
    const destinationRegion = process.env.ALTER_REGION ?? process.env.AWS_REGION ?? "ap-south-1";
    await assertTenantRegion(tenantRegion, destinationRegion, this.auditClient, {
      tenantId,
      actorType: "system",
      actorRef: "platform-api",
      action: "credential.write",
      targetType: "credential",
      targetRef: id,
    });

    const reference = secretReference(tenantId, id);
    // putSecret overwrites in place -- unlike create()'s fresh reference,
    // there is no separate old/new slot to roll back between. The old
    // value must be read out *before* the overwrite so it can be restored
    // if the DB write below fails; without this, a failed update silently
    // leaves the new secret live with the DB still describing the old one
    // (or, on total DB failure, an unrecoverable overwrite with nothing to
    // compensate at all).
    const priorValue =
      input.value === undefined ? undefined : await this.secrets.getSecret(reference);

    try {
      if (input.value !== undefined) {
        await this.secrets.putSecret(reference, input.value);
      }
      const updated = await this.repository.update(
        tenantId,
        id,
        {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.connector === undefined
            ? {}
            : { connector: input.connector }),
          ...(input.scope === undefined ? {} : { scope: input.scope }),
        },
        input.value === undefined ? undefined : secretLast4(input.value),
      );
      if (!updated) throw notFound(instance);
      return project(updated);
    } catch (error) {
      if (priorValue !== undefined) {
        await bestEffortRestore(this.secrets, reference, priorValue);
      }
      if (error instanceof CredentialHttpError) throw error;
      throw providerFailure(error, instance);
    }
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const instance = `/api/v1/credentials/${id}`;
    await this.requireRecord(tenantId, id, instance);
    try {
      await this.secrets.deleteSecret(secretReference(tenantId, id));
      if (!(await this.repository.delete(tenantId, id))) throw notFound(instance);
    } catch (error) {
      if (error instanceof CredentialHttpError) throw error;
      throw providerFailure(error, instance);
    }
  }

  async resolve(
    tenantId: string,
    id: string,
    requestedScope: string,
    actorId: string,
  ): Promise<string> {
    const instance = `/internal/credentials/${id}/resolve`;
    const record = await this.requireRecord(tenantId, id, instance);
    if (record.scope !== requestedScope) {
      throw new CredentialHttpError(
        403,
        "CREDENTIAL_SCOPE_DENIED",
        "Credential scope denied",
        instance,
      );
    }

    const tenantRegion = await this.repository.getTenantRegion(tenantId);
    const destinationRegion = process.env.ALTER_REGION ?? process.env.AWS_REGION ?? "ap-south-1";
    await assertTenantRegion(tenantRegion, destinationRegion, this.auditClient, {
      tenantId,
      actorType: "user",
      actorRef: actorId,
      action: "credential.read",
      targetType: "credential",
      targetRef: id,
    });

    try {
      const value = await this.secrets.getSecret(secretReference(tenantId, id));
      await this.repository.recordUse(tenantId, id, actorId);
      return value;
    } catch (error) {
      throw providerFailure(error, instance);
    }
  }

  private async requireRecord(
    tenantId: string,
    id: string,
    instance: string,
  ): Promise<CredentialRecord> {
    const record = await this.repository.find(tenantId, id);
    if (!record) throw notFound(instance);
    return record;
  }
}

export function secretReference(tenantId: string, id: string): string {
  return `/alter/credentials/${tenantId}/${id}`;
}

function project(record: CredentialRecord): CredentialView {
  return {
    id: record.id,
    name: record.name,
    connector: record.connector,
    scope: record.scope,
    last4: maskSecretLast4(record.last4),
    created_at: record.createdAt.toISOString(),
    version: record.updatedAt.toISOString(),
  };
}

function notFound(instance: string): CredentialHttpError {
  return new CredentialHttpError(
    404,
    "CREDENTIAL_NOT_FOUND",
    "Credential not found",
    instance,
  );
}

function providerFailure(error: unknown, instance: string): CredentialHttpError {
  if (error instanceof CredentialHttpError) return error;
  return new CredentialHttpError(
    502,
    "CREDENTIAL_PROVIDER_ERROR",
    "Credential provider operation failed",
    instance,
  );
}

async function bestEffortDelete(
  provider: MutableSecretsProvider,
  reference: string,
): Promise<void> {
  try {
    await provider.deleteSecret(reference);
  } catch {
    // Preserve the original provider or metadata-store failure.
  }
}

async function bestEffortRestore(
  provider: MutableSecretsProvider,
  reference: string,
  priorValue: string,
): Promise<void> {
  try {
    await provider.putSecret(reference, priorValue);
  } catch {
    // Preserve the original provider or metadata-store failure. The
    // secret is left holding the new value with no matching DB update --
    // a real gap, but a narrower one than an unconditional silent
    // overwrite, and one that already surfaces as a provider error
    // rather than nothing at all.
  }
}
