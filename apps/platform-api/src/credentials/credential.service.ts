import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  maskSecretLast4,
  secretLast4,
  type MutableSecretsProvider,
} from "@alterx/shared-clients";
import { CredentialRepository } from "./credential.repository";
import { CredentialHttpError } from "./problem";
import { CREDENTIAL_SECRETS_PROVIDER } from "./tokens";
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
  ) {}

  async create(
    tenantId: string,
    input: CreateCredentialInput,
  ): Promise<CredentialView> {
    const id = randomUUID();
    const reference = secretReference(tenantId, id);
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
    try {
      if (input.value !== undefined) {
        await this.secrets.putSecret(secretReference(tenantId, id), input.value);
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
