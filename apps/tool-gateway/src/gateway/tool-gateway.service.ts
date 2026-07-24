import { randomUUID } from "node:crypto";

import type {
  ToolgwFetchUrlRequest,
  ToolgwFetchUrlResponse,
  ToolgwInvokeToolRequest,
  ToolgwInvokeToolResponse,
  ToolgwResolveCredentialRequest,
  ToolgwResolveCredentialResponse,
} from "@alterx/contracts";
import {
  ToolGatewayNotImplementedError,
  ToolGatewayPermissionError,
  ToolGatewayRateLimitError,
  ToolGatewayValidationError,
  type ToolgwHandler,
} from "@alterx/adapters";
import type {
  ConfigProvider,
  SecretsProvider,
  ToolPermissionBinding,
} from "@alterx/shared-clients";

interface CredentialRecord {
  readonly secretValue: string;
  readonly expiresAtMs: number;
  readonly tenantId: string;
  readonly integrationId?: string;
}

interface RateLimitBucket {
  readonly windowStartedAtMs: number;
  count: number;
}

export interface ToolGatewayServiceOptions {
  readonly credentialTokenTtlMs?: number;
  readonly maxCredentialTokens?: number;
  readonly now?: () => Date;
  readonly mintCredentialToken?: () => string;
}

const DEFAULT_CREDENTIAL_TOKEN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CREDENTIAL_TOKENS = 10_000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const OPAQUE_CREDENTIAL_TOKEN_PREFIX = "cred_";

export class ToolGatewayService implements ToolgwHandler {
  readonly #credentialTokens = new Map<string, CredentialRecord>();
  readonly #rateLimits = new Map<string, RateLimitBucket>();
  readonly #credentialTokenTtlMs: number;
  readonly #maxCredentialTokens: number;
  readonly #now: () => Date;
  readonly #mintCredentialToken: () => string;

  constructor(
    private readonly configProvider: ConfigProvider,
    private readonly secretsProvider: SecretsProvider,
    options: ToolGatewayServiceOptions = {},
  ) {
    this.#credentialTokenTtlMs =
      options.credentialTokenTtlMs ?? DEFAULT_CREDENTIAL_TOKEN_TTL_MS;
    this.#maxCredentialTokens =
      options.maxCredentialTokens ?? DEFAULT_MAX_CREDENTIAL_TOKENS;
    this.#now = options.now ?? (() => new Date());
    this.#mintCredentialToken =
      options.mintCredentialToken ?? (() => `cred_${randomUUID()}`);
  }

  async invokeTool(
    request: ToolgwInvokeToolRequest,
  ): Promise<ToolgwInvokeToolResponse> {
    validateInvokeToolRequest(request);
    const binding = await this.configProvider.resolveToolPermission({
      tenantId: request.tenant_id,
      toolName: request.tool_name,
    });
    ensureAllowed(binding, request.tool_name);
    this.#enforceRateLimit(request.tenant_id, request.tool_name, binding);
    await this.#resolveCredentialReference(
      request.credential_ref,
      request.tenant_id,
    );

    throw new ToolGatewayNotImplementedError(
      "Tool dispatch ships when the first real tool lands in GATE-8",
    );
  }

  async resolveCredential(
    request: ToolgwResolveCredentialRequest,
  ): Promise<ToolgwResolveCredentialResponse> {
    validateResolveCredentialRequest(request);
    assertCredentialReferenceOwnedBy(
      request.credential_ref,
      request.tenant_id,
      request.integration_id,
    );
    const secretValue = await this.secretsProvider.getSecret(
      request.credential_ref,
    );
    const { expiresAtMs, token } = this.#mintCredentialRecord({
      secretValue,
      tenantId: request.tenant_id,
      integrationId: request.integration_id,
    });
    return {
      resolved_reference: token,
      expires_at: new Date(expiresAtMs).toISOString(),
    };
  }

  async fetchUrl(
    request: ToolgwFetchUrlRequest,
  ): Promise<ToolgwFetchUrlResponse> {
    void request;
    throw new ToolGatewayNotImplementedError(
      "SSRF-guarded URL fetch ships in GATE-8",
    );
  }

  #enforceRateLimit(
    tenantId: string,
    toolName: string,
    binding: ToolPermissionBinding,
  ): void {
    const nowMs = this.#now().getTime();
    const key = `${tenantId}:${toolName}`;
    const bucket = this.#rateLimits.get(key);
    if (
      bucket === undefined ||
      nowMs - bucket.windowStartedAtMs >= RATE_LIMIT_WINDOW_MS
    ) {
      this.#rateLimits.set(key, { windowStartedAtMs: nowMs, count: 1 });
      return;
    }
    bucket.count += 1;
    if (bucket.count > binding.rateLimitPerMinute) {
      throw new ToolGatewayRateLimitError(
        `Rate limit exceeded for tool ${toolName}`,
      );
    }
  }

  async #resolveCredentialReference(
    reference: string,
    tenantId: string,
  ): Promise<void> {
    this.#sweepExpiredCredentialTokens();
    const record = this.#credentialTokens.get(reference);
    if (record === undefined) {
      if (reference.startsWith(OPAQUE_CREDENTIAL_TOKEN_PREFIX)) {
        throw new ToolGatewayValidationError(
          "Credential token is not recognized",
        );
      }
      assertCredentialReferenceOwnedBy(reference, tenantId);
      await this.#resolveRawSecretReference(reference, tenantId);
      return;
    }
    if (record.expiresAtMs <= this.#now().getTime()) {
      this.#credentialTokens.delete(reference);
      throw new ToolGatewayValidationError("Credential token expired");
    }
    if (record.tenantId !== tenantId) {
      throw new ToolGatewayValidationError(
        "Credential token is not owned by this tenant",
      );
    }
    // Real credential exists only in memory so later GATE-8 dispatch can use it
    // without accepting raw secrets over gRPC.
    void record.secretValue;
    return;
  }

  #mintCredentialRecord(record: {
    readonly secretValue: string;
    readonly tenantId: string;
    readonly integrationId?: string;
  }): {
    readonly expiresAtMs: number;
    readonly token: string;
  } {
    this.#evictCredentialTokensIfNeeded();
    const expiresAtMs = this.#now().getTime() + this.#credentialTokenTtlMs;
    const token = this.#mintUniqueCredentialToken();
    this.#credentialTokens.set(token, { ...record, expiresAtMs });
    return { expiresAtMs, token };
  }

  async #resolveRawSecretReference(
    reference: string,
    tenantId: string,
  ): Promise<void> {
    const secretValue = await this.secretsProvider.getSecret(reference);
    this.#mintCredentialRecord({ secretValue, tenantId });
  }

  #mintUniqueCredentialToken(): string {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = this.#mintCredentialToken();
      if (!this.#credentialTokens.has(token)) {
        return token;
      }
    }
    throw new Error("Could not mint a unique credential token");
  }

  #evictCredentialTokensIfNeeded(): void {
    this.#sweepExpiredCredentialTokens();
    if (this.#credentialTokens.size < this.#maxCredentialTokens) {
      return;
    }
    let oldestToken: string | undefined;
    let oldestExpiresAtMs = Number.POSITIVE_INFINITY;
    for (const [token, record] of this.#credentialTokens.entries()) {
      if (record.expiresAtMs < oldestExpiresAtMs) {
        oldestToken = token;
        oldestExpiresAtMs = record.expiresAtMs;
      }
    }
    if (oldestToken !== undefined) {
      this.#credentialTokens.delete(oldestToken);
    }
  }

  #sweepExpiredCredentialTokens(): void {
    const nowMs = this.#now().getTime();
    for (const [token, record] of this.#credentialTokens.entries()) {
      if (record.expiresAtMs <= nowMs) {
        this.#credentialTokens.delete(token);
      }
    }
  }
}

function ensureAllowed(
  binding: ToolPermissionBinding,
  toolName: string,
): void {
  if (!binding.allowed) {
    throw new ToolGatewayPermissionError(
      `Tool ${toolName} is not permitted for this tenant`,
    );
  }
  if (
    !Number.isInteger(binding.rateLimitPerMinute) ||
    binding.rateLimitPerMinute < 1
  ) {
    throw new ToolGatewayValidationError(
      "Tool permission rateLimitPerMinute must be a positive integer",
    );
  }
}

function validateInvokeToolRequest(request: ToolgwInvokeToolRequest): void {
  requireNonEmpty(request.tenant_id, "tenant_id");
  requireNonEmpty(request.run_id, "run_id");
  requireNonEmpty(request.node_execution_id, "node_execution_id");
  requireNonEmpty(request.tool_name, "tool_name");
  requireNonEmpty(request.input_json, "input_json");
  requireNonEmpty(request.credential_ref, "credential_ref");
  try {
    JSON.parse(request.input_json);
  } catch {
    throw new ToolGatewayValidationError("input_json must be valid JSON");
  }
}

function validateResolveCredentialRequest(
  request: ToolgwResolveCredentialRequest,
): void {
  requireNonEmpty(request.tenant_id, "tenant_id");
  requireNonEmpty(request.integration_id, "integration_id");
  requireNonEmpty(request.credential_ref, "credential_ref");
}

function assertCredentialReferenceOwnedBy(
  credentialRef: string,
  tenantId: string,
  integrationId?: string,
): void {
  const ownership = parseTenantIntegrationSecretReference(credentialRef);
  if (ownership === undefined) {
    throw new ToolGatewayValidationError(
      "credential_ref must be a tenant integration secret reference",
    );
  }
  if (
    ownership.tenantId !== tenantId ||
    (integrationId !== undefined && ownership.integrationId !== integrationId)
  ) {
    throw new ToolGatewayValidationError(
      "credential_ref is not owned by this tenant/integration",
    );
  }
}

function parseTenantIntegrationSecretReference(
  credentialRef: string,
):
  | {
      readonly tenantId: string;
      readonly integrationId: string;
    }
  | undefined {
  const segments = credentialRef.split("/").filter((segment) => segment.length > 0);
  if (
    segments.length < 7 ||
    segments[0] !== "alter" ||
    segments[2] !== "tenant" ||
    segments[4] !== "integration"
  ) {
    return undefined;
  }
  const tenantSegment = segments[3];
  const integrationSegment = segments[5];
  if (tenantSegment === undefined || integrationSegment === undefined) {
    return undefined;
  }
  return {
    tenantId: tenantSegment,
    integrationId: integrationSegment,
  };
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new ToolGatewayValidationError(`${field} is required`);
  }
}
