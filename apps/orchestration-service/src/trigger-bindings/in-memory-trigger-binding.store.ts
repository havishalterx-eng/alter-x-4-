import type { TriggerBindingConfig } from "@alterx/contracts";
import type {
  NewWebhookEndpoint,
  NewWebhookSecret,
  RotationOutcome,
  TriggerBindingRecord,
  TriggerBindingStore,
  TriggerDispatchInfo,
  TriggerScope,
  UpsertBindingInput,
  WebhookEndpointRecord,
  WebhookRouting,
  WebhookSecretRecord,
} from "./types";

export interface SeedTrigger {
  readonly tenantId: string;
  readonly triggerId: string;
  readonly workspaceId: string;
  readonly type: string;
  readonly status?: string;
  readonly activeVersion?: number;
  readonly dlqMaxReceiveCount?: number;
}

/**
 * Reference implementation of TriggerBindingStore with no database. It
 * enforces the same invariants the schema does -- one endpoint per
 * (tenant, workspace, integration), at most one active secret per endpoint,
 * one binding per (tenant, trigger, integration) -- so a test against it
 * exercises the real service logic, not a permissive stub.
 */
export class InMemoryTriggerBindingStore implements TriggerBindingStore {
  readonly #triggers = new Map<string, TriggerDispatchInfo>();
  readonly #endpoints = new Map<string, WebhookEndpointRecord>();
  readonly #secrets: WebhookSecretRecord[] = [];
  readonly #bindings = new Map<string, TriggerBindingRecord>();

  constructor(triggers: readonly SeedTrigger[] = []) {
    for (const trigger of triggers) {
      this.#triggers.set(`${trigger.tenantId}:${trigger.triggerId}`, {
        triggerId: trigger.triggerId,
        workspaceId: trigger.workspaceId,
        type: trigger.type,
        status: trigger.status ?? "enabled",
        activeVersion: trigger.activeVersion ?? null,
        dlqMaxReceiveCount: trigger.dlqMaxReceiveCount ?? null,
      });
    }
  }

  /** Test-only view of persisted secret rows; refs only, never values. */
  get secretRows(): readonly WebhookSecretRecord[] {
    return [...this.#secrets];
  }

  async findTriggerScope(
    tenantId: string,
    triggerId: string,
  ): Promise<TriggerScope | null> {
    const info = this.#triggers.get(`${tenantId}:${triggerId}`);
    return info === undefined
      ? null
      : {
          triggerId: info.triggerId,
          workspaceId: info.workspaceId,
          type: info.type,
        };
  }

  async findTriggerDispatchInfo(
    tenantId: string,
    triggerId: string,
  ): Promise<TriggerDispatchInfo | null> {
    return this.#triggers.get(`${tenantId}:${triggerId}`) ?? null;
  }

  async findEndpointByIntegration(
    tenantId: string,
    workspaceId: string,
    integrationId: string,
  ): Promise<WebhookEndpointRecord | null> {
    for (const endpoint of this.#endpoints.values()) {
      if (
        endpoint.tenantId === tenantId &&
        endpoint.workspaceId === workspaceId &&
        endpoint.integrationId === integrationId
      ) {
        return endpoint;
      }
    }
    return null;
  }

  async findEndpointById(
    tenantId: string,
    endpointId: string,
  ): Promise<WebhookEndpointRecord | null> {
    const endpoint = this.#endpoints.get(endpointId);
    return endpoint !== undefined && endpoint.tenantId === tenantId
      ? endpoint
      : null;
  }

  async createEndpointWithSecret(
    tenantId: string,
    endpoint: NewWebhookEndpoint,
    secret: NewWebhookSecret,
  ): Promise<{
    readonly endpoint: WebhookEndpointRecord;
    readonly secret: WebhookSecretRecord;
  }> {
    const existing = await this.findEndpointByIntegration(
      tenantId,
      endpoint.workspaceId,
      endpoint.integrationId,
    );
    if (existing !== null) {
      throw new Error(
        "webhook_endpoints_tenant_workspace_integration_unique violated",
      );
    }
    const record: WebhookEndpointRecord = {
      id: endpoint.id,
      tenantId,
      workspaceId: endpoint.workspaceId,
      integrationId: endpoint.integrationId,
      pathToken: endpoint.pathToken,
      maxSkewSeconds: endpoint.maxSkewSeconds,
      createdAt: new Date(),
    };
    this.#endpoints.set(record.id, record);
    const secretRecord: WebhookSecretRecord = {
      id: secret.id,
      tenantId,
      endpointId: endpoint.id,
      version: secret.version,
      secretRef: secret.secretRef,
      status: "active",
      createdAt: new Date(),
      revokedAt: null,
    };
    this.#secrets.push(secretRecord);
    return { endpoint: record, secret: secretRecord };
  }

  async upsertBinding(
    tenantId: string,
    input: UpsertBindingInput,
  ): Promise<TriggerBindingRecord> {
    const key = `${tenantId}:${input.triggerId}:${input.integrationId}`;
    const existing = this.#bindings.get(key);
    const record: TriggerBindingRecord = {
      id: existing?.id ?? input.id,
      tenantId,
      workspaceId: input.workspaceId,
      triggerId: input.triggerId,
      integrationId: input.integrationId,
      webhookEndpointId: input.webhookEndpointId,
      config: cloneConfig(input.config),
      status: "active",
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.#bindings.set(key, record);
    return record;
  }

  async listBindings(
    tenantId: string,
    triggerId: string,
  ): Promise<readonly TriggerBindingRecord[]> {
    return [...this.#bindings.values()].filter(
      (binding) =>
        binding.tenantId === tenantId && binding.triggerId === triggerId,
    );
  }

  async disableBinding(
    tenantId: string,
    triggerId: string,
    bindingId: string,
  ): Promise<TriggerBindingRecord | null> {
    for (const [key, binding] of this.#bindings) {
      if (
        binding.tenantId === tenantId &&
        binding.triggerId === triggerId &&
        binding.id === bindingId
      ) {
        const updated: TriggerBindingRecord = {
          ...binding,
          status: "disabled",
          updatedAt: new Date(),
        };
        this.#bindings.set(key, updated);
        return updated;
      }
    }
    return null;
  }

  async findActiveSecret(
    tenantId: string,
    endpointId: string,
  ): Promise<WebhookSecretRecord | null> {
    return (
      this.#secrets.find(
        (secret) =>
          secret.tenantId === tenantId &&
          secret.endpointId === endpointId &&
          secret.status === "active",
      ) ?? null
    );
  }

  async rotateSecret(
    tenantId: string,
    endpointId: string,
    next: NewWebhookSecret,
    rotatedAt: Date,
  ): Promise<RotationOutcome> {
    let previous: WebhookSecretRecord | null = null;
    for (let index = 0; index < this.#secrets.length; index += 1) {
      const secret = this.#secrets[index]!;
      if (
        secret.tenantId === tenantId &&
        secret.endpointId === endpointId &&
        secret.status === "active"
      ) {
        previous = { ...secret, status: "revoked", revokedAt: rotatedAt };
        this.#secrets[index] = previous;
      }
    }
    // Mirrors the partial unique index: a second active row for the same
    // endpoint is impossible, so a rotation that failed to revoke would fail
    // here rather than silently leaving two valid secrets.
    if (
      this.#secrets.some(
        (secret) =>
          secret.tenantId === tenantId &&
          secret.endpointId === endpointId &&
          secret.status === "active",
      )
    ) {
      throw new Error("webhook_endpoint_secrets_single_active violated");
    }
    const inserted: WebhookSecretRecord = {
      id: next.id,
      tenantId,
      endpointId,
      version: next.version,
      secretRef: next.secretRef,
      status: "active",
      createdAt: rotatedAt,
      revokedAt: null,
    };
    this.#secrets.push(inserted);
    return { previous, next: inserted, rotatedAt };
  }

  async resolveByPathToken(pathToken: string): Promise<WebhookRouting | null> {
    for (const endpoint of this.#endpoints.values()) {
      if (endpoint.pathToken !== pathToken) {
        continue;
      }
      const secret = await this.findActiveSecret(
        endpoint.tenantId,
        endpoint.id,
      );
      if (secret === null) {
        return null;
      }
      return {
        endpointId: endpoint.id,
        tenantId: endpoint.tenantId,
        workspaceId: endpoint.workspaceId,
        integrationId: endpoint.integrationId,
        maxSkewSeconds: endpoint.maxSkewSeconds,
        secretRef: secret.secretRef,
        secretVersion: secret.version,
      };
    }
    return null;
  }

  async listActiveBindingsForEndpoint(
    tenantId: string,
    endpointId: string,
  ): Promise<readonly TriggerBindingRecord[]> {
    return [...this.#bindings.values()].filter(
      (binding) =>
        binding.tenantId === tenantId &&
        binding.webhookEndpointId === endpointId &&
        binding.status === "active",
    );
  }
}

function cloneConfig(config: TriggerBindingConfig): TriggerBindingConfig {
  return {
    eventTypes: [...config.eventTypes],
    ...(config.filter === undefined ? {} : { filter: { ...config.filter } }),
  };
}
