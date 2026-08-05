import type {
  TriggerBindingConfig,
  TriggerBindingStatus,
} from "@alterx/contracts";

export type { TriggerBindingConfig, TriggerBindingStatus };

export interface WebhookEndpointRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly integrationId: string;
  /** Unguessable URL path segment. Not an authenticator on its own. */
  readonly pathToken: string;
  readonly maxSkewSeconds: number;
  readonly createdAt: Date;
}

export type WebhookSecretStatus = "active" | "revoked";

/**
 * A signing-secret record. `secretRef` addresses material in SecretsProvider;
 * the secret value itself is never held on this type, never persisted, and
 * never serialised into a response or a log line.
 */
export interface WebhookSecretRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly endpointId: string;
  readonly version: number;
  readonly secretRef: string;
  readonly status: WebhookSecretStatus;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

export interface TriggerBindingRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly triggerId: string;
  readonly integrationId: string;
  readonly webhookEndpointId: string;
  readonly config: TriggerBindingConfig;
  readonly status: TriggerBindingStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Minimal trigger facts the binding path needs, for workspace scoping. */
export interface TriggerScope {
  readonly triggerId: string;
  readonly workspaceId: string;
  readonly type: string;
}

/**
 * What the public receiver needs to verify and route a delivery, resolved
 * without tenant context (the caller is not authenticated yet). Only the
 * currently-active secret is ever resolvable here.
 */
export interface WebhookRouting {
  readonly endpointId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly integrationId: string;
  readonly maxSkewSeconds: number;
  readonly secretRef: string;
  readonly secretVersion: number;
}

export interface NewWebhookEndpoint {
  readonly id: string;
  readonly workspaceId: string;
  readonly integrationId: string;
  readonly pathToken: string;
  readonly maxSkewSeconds: number;
}

export interface NewWebhookSecret {
  readonly id: string;
  readonly version: number;
  readonly secretRef: string;
}

export interface RotationOutcome {
  readonly previous: WebhookSecretRecord | null;
  readonly next: WebhookSecretRecord;
  readonly rotatedAt: Date;
}

export interface UpsertBindingInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly triggerId: string;
  readonly integrationId: string;
  readonly webhookEndpointId: string;
  readonly config: TriggerBindingConfig;
}

/**
 * Persistence port for ENG-BINDING. Everything the feature needs from a
 * database is expressed here, so the module drops into any host that can
 * supply an implementation: PostgresTriggerBindingStore for production,
 * InMemoryTriggerBindingStore for tests.
 */
export interface TriggerBindingStore {
  findTriggerScope(
    tenantId: string,
    triggerId: string,
  ): Promise<TriggerScope | null>;

  findEndpointByIntegration(
    tenantId: string,
    workspaceId: string,
    integrationId: string,
  ): Promise<WebhookEndpointRecord | null>;

  findEndpointById(
    tenantId: string,
    endpointId: string,
  ): Promise<WebhookEndpointRecord | null>;

  /** Creates an endpoint and its first active secret in one transaction. */
  createEndpointWithSecret(
    tenantId: string,
    endpoint: NewWebhookEndpoint,
    secret: NewWebhookSecret,
  ): Promise<{
    readonly endpoint: WebhookEndpointRecord;
    readonly secret: WebhookSecretRecord;
  }>;

  upsertBinding(
    tenantId: string,
    input: UpsertBindingInput,
  ): Promise<TriggerBindingRecord>;

  listBindings(
    tenantId: string,
    triggerId: string,
  ): Promise<readonly TriggerBindingRecord[]>;

  disableBinding(
    tenantId: string,
    triggerId: string,
    bindingId: string,
  ): Promise<TriggerBindingRecord | null>;

  findActiveSecret(
    tenantId: string,
    endpointId: string,
  ): Promise<WebhookSecretRecord | null>;

  /**
   * Revokes the current active secret and inserts the replacement in ONE
   * transaction. Implementations must not leave both rows active even
   * transiently outside the transaction; migration 0022's partial unique
   * index enforces this at the database level.
   */
  rotateSecret(
    tenantId: string,
    endpointId: string,
    next: NewWebhookSecret,
    rotatedAt: Date,
  ): Promise<RotationOutcome>;

  /** Tenant-less lookup for the public receiver; active secret only. */
  resolveByPathToken(pathToken: string): Promise<WebhookRouting | null>;

  listActiveBindingsForEndpoint(
    tenantId: string,
    endpointId: string,
  ): Promise<readonly TriggerBindingRecord[]>;
}
