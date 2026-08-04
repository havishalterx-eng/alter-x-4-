import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  maskSecretLast4,
  secretLast4,
  type MutableSecretsProvider,
} from "@alterx/shared-clients";
import { EnvVarRepository } from "./env-var.repository";
import { EnvVarHttpError } from "./problem";
import { ENV_VAR_SECRETS_PROVIDER } from "./tokens";
import type {
  CreateEnvVarInput,
  EnvVarRecord,
  EnvVarView,
  UpdateEnvVarInput,
} from "./types";

@Injectable()
export class EnvVarService {
  constructor(
    private readonly repository: EnvVarRepository,
    @Inject(ENV_VAR_SECRETS_PROVIDER)
    private readonly secrets: MutableSecretsProvider,
  ) {}

  async create(
    tenantId: string,
    projectId: string,
    input: CreateEnvVarInput,
  ): Promise<EnvVarView> {
    const id = randomUUID();
    const reference = secretReference(tenantId, id);
    try {
      await this.secrets.putSecret(reference, input.value);
      const record = await this.repository.create(
        tenantId,
        id,
        projectId,
        { environment: input.environment, key: input.key },
        secretLast4(input.value),
      );
      return project(record);
    } catch (error) {
      await bestEffortDelete(this.secrets, reference);
      if (isUniqueViolation(error)) {
        throw new EnvVarHttpError(
          409,
          "ENV_VAR_ALREADY_EXISTS",
          "Environment variable already exists",
          collectionInstance(projectId),
        );
      }
      throw providerFailure(error, collectionInstance(projectId));
    }
  }

  async list(tenantId: string, projectId: string): Promise<EnvVarView[]> {
    return (await this.repository.list(tenantId, projectId)).map(project);
  }

  async get(
    tenantId: string,
    projectId: string,
    id: string,
    instance = itemInstance(projectId, id),
  ): Promise<EnvVarView> {
    return project(await this.requireRecord(tenantId, projectId, id, instance));
  }

  async update(
    tenantId: string,
    projectId: string,
    id: string,
    input: UpdateEnvVarInput,
  ): Promise<EnvVarView> {
    const instance = itemInstance(projectId, id);
    await this.requireRecord(tenantId, projectId, id, instance);
    try {
      if (input.value !== undefined) {
        await this.secrets.putSecret(secretReference(tenantId, id), input.value);
      }
      const updated = await this.repository.update(
        tenantId,
        projectId,
        id,
        {
          ...(input.environment === undefined
            ? {}
            : { environment: input.environment }),
          ...(input.key === undefined ? {} : { key: input.key }),
        },
        input.value === undefined ? undefined : secretLast4(input.value),
      );
      if (!updated) throw notFound(instance);
      return project(updated);
    } catch (error) {
      if (error instanceof EnvVarHttpError) throw error;
      if (isUniqueViolation(error)) {
        throw new EnvVarHttpError(
          409,
          "ENV_VAR_ALREADY_EXISTS",
          "Environment variable already exists",
          instance,
        );
      }
      throw providerFailure(error, instance);
    }
  }

  async delete(
    tenantId: string,
    projectId: string,
    id: string,
  ): Promise<void> {
    const instance = itemInstance(projectId, id);
    await this.requireRecord(tenantId, projectId, id, instance);
    try {
      await this.secrets.deleteSecret(secretReference(tenantId, id));
      if (!(await this.repository.delete(tenantId, projectId, id))) {
        throw notFound(instance);
      }
    } catch (error) {
      if (error instanceof EnvVarHttpError) throw error;
      throw providerFailure(error, instance);
    }
  }

  async resolve(
    tenantId: string,
    projectId: string,
    id: string,
    actorId: string,
  ): Promise<string> {
    const instance = `/internal/projects/${projectId}/env-vars/${id}/resolve`;
    await this.requireRecord(tenantId, projectId, id, instance);
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
    projectId: string,
    id: string,
    instance: string,
  ): Promise<EnvVarRecord> {
    const record = await this.repository.find(tenantId, projectId, id);
    if (!record) throw notFound(instance);
    return record;
  }
}

export function secretReference(tenantId: string, id: string): string {
  return `/alter/env-vars/${tenantId}/${id}`;
}

function project(record: EnvVarRecord): EnvVarView {
  return {
    id: record.id,
    project_id: record.projectId,
    environment: record.environment,
    key: record.key,
    last4: maskSecretLast4(record.last4),
    created_at: record.createdAt.toISOString(),
    version: record.updatedAt.toISOString(),
  };
}

function collectionInstance(projectId: string): string {
  return `/api/v1/projects/${projectId}/env-vars`;
}

function itemInstance(projectId: string, id: string): string {
  return `${collectionInstance(projectId)}/${id}`;
}

function notFound(instance: string): EnvVarHttpError {
  return new EnvVarHttpError(
    404,
    "ENV_VAR_NOT_FOUND",
    "Environment variable not found",
    instance,
  );
}

function providerFailure(error: unknown, instance: string): EnvVarHttpError {
  if (error instanceof EnvVarHttpError) return error;
  return new EnvVarHttpError(
    502,
    "ENV_VAR_PROVIDER_ERROR",
    "Environment variable provider operation failed",
    instance,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

async function bestEffortDelete(
  provider: MutableSecretsProvider,
  reference: string,
): Promise<void> {
  try {
    await provider.deleteSecret(reference);
  } catch {
    // Preserve original provider or metadata-store failure.
  }
}
