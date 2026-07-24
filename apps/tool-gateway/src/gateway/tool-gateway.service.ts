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
  SsrfBlockedError,
  SsrfGuardedFetcher,
  ToolGatewayNotImplementedError,
  ToolGatewayPermissionError,
  ToolGatewayRateLimitError,
  ToolGatewayValidationError,
  type ToolgwHandler,
} from "@alterx/adapters";
import type {
  AuditEventHandler,
  ConfigProvider,
  SearchProvider,
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

interface ArtifactRecord {
  readonly body: ArrayBuffer;
  readonly expiresAtMs: number;
}

export interface ToolGatewayServiceOptions {
  readonly credentialTokenTtlMs?: number;
  readonly maxCredentialTokens?: number;
  readonly artifactTtlMs?: number;
  readonly maxArtifacts?: number;
  readonly now?: () => Date;
  readonly mintCredentialToken?: () => string;
  readonly mintId?: () => string;
}

const DEFAULT_CREDENTIAL_TOKEN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CREDENTIAL_TOKENS = 10_000;
const DEFAULT_ARTIFACT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ARTIFACTS = 1_000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const OPAQUE_CREDENTIAL_TOKEN_PREFIX = "cred_";
const SEARCH_WEB_TOOL_NAME = "search.web";

export class ToolGatewayService implements ToolgwHandler {
  readonly #credentialTokens = new Map<string, CredentialRecord>();
  readonly #rateLimits = new Map<string, RateLimitBucket>();
  readonly #artifacts = new Map<string, ArtifactRecord>();
  readonly #credentialTokenTtlMs: number;
  readonly #maxCredentialTokens: number;
  readonly #artifactTtlMs: number;
  readonly #maxArtifacts: number;
  readonly #now: () => Date;
  readonly #mintCredentialToken: () => string;
  readonly #mintId: () => string;

  constructor(
    private readonly configProvider: ConfigProvider,
    private readonly secretsProvider: SecretsProvider,
    private readonly searchProvider: SearchProvider,
    private readonly urlFetcher: SsrfGuardedFetcher,
    private readonly auditClient: AuditEventHandler,
    options: ToolGatewayServiceOptions = {},
  ) {
    this.#credentialTokenTtlMs =
      options.credentialTokenTtlMs ?? DEFAULT_CREDENTIAL_TOKEN_TTL_MS;
    this.#maxCredentialTokens =
      options.maxCredentialTokens ?? DEFAULT_MAX_CREDENTIAL_TOKENS;
    this.#artifactTtlMs = options.artifactTtlMs ?? DEFAULT_ARTIFACT_TTL_MS;
    this.#maxArtifacts = options.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS;
    this.#now = options.now ?? (() => new Date());
    this.#mintCredentialToken =
      options.mintCredentialToken ?? (() => `cred_${randomUUID()}`);
    this.#mintId = options.mintId ?? (() => randomUUID());
  }

  async invokeTool(
    request: ToolgwInvokeToolRequest,
  ): Promise<ToolgwInvokeToolResponse> {
    try {
      validateInvokeToolRequest(request);
      const binding = await this.configProvider.resolveToolPermission({
        tenantId: request.tenant_id,
        toolName: request.tool_name,
      });
      try {
        ensureAllowed(binding, request.tool_name);
      } catch (error: unknown) {
        await this.#auditToolInvocation(request, "denied");
        throw error;
      }
      try {
        this.#enforceRateLimit(request.tenant_id, request.tool_name, binding);
      } catch (error: unknown) {
        await this.#auditToolInvocation(request, "denied");
        throw error;
      }
      await this.#resolveCredentialReference(
        request.credential_ref,
        request.tenant_id,
      );

      if (request.tool_name === SEARCH_WEB_TOOL_NAME) {
        const response = await this.#dispatchSearchWeb(request);
        await this.#auditToolInvocation(request, "success");
        return response;
      }

      throw new ToolGatewayNotImplementedError(
        `Tool ${request.tool_name} has no real dispatch yet; only ${SEARCH_WEB_TOOL_NAME} is wired`,
      );
    } catch (error: unknown) {
      if (error instanceof ToolGatewayNotImplementedError) {
        throw error;
      }
      if (
        error instanceof ToolGatewayPermissionError ||
        error instanceof ToolGatewayRateLimitError
      ) {
        throw error;
      }
      await this.#auditToolInvocation(request, "error");
      throw error;
    }
  }

  async #dispatchSearchWeb(
    request: ToolgwInvokeToolRequest,
  ): Promise<ToolgwInvokeToolResponse> {
    const input = parseSearchWebInput(request.input_json);
    const result = await this.searchProvider.search({
      tenantId: request.tenant_id,
      query: input.query,
      ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
    });
    return {
      output_json: JSON.stringify(result),
      audit_id: this.#mintId(),
    };
  }

  async #auditToolInvocation(
    request: ToolgwInvokeToolRequest,
    result: "success" | "denied" | "error",
  ): Promise<void> {
    await this.#recordAuditEventBestEffort({
      tenant_id: request.tenant_id,
      actor_type: "service",
      actor_ref: "tool-gateway",
      action: "tool.invoke",
      target_type: "tool",
      target_ref: request.tool_name,
      result,
      reason_code: "",
      context_json: JSON.stringify({
        runId: request.run_id,
        nodeExecutionId: request.node_execution_id,
      }),
      occurred_at: this.#now().toISOString(),
    });
  }

  async #recordAuditEventBestEffort(request: {
    readonly tenant_id: string;
    readonly actor_type: "service";
    readonly actor_ref: string;
    readonly action: string;
    readonly target_type: string;
    readonly target_ref: string;
    readonly result: "success" | "denied" | "error";
    readonly reason_code: string;
    readonly context_json: string;
    readonly occurred_at: string;
  }): Promise<void> {
    try {
      await this.auditClient.recordEvent(request);
    } catch {
      // Audit logging is best-effort: a full or unreachable audit-service
      // must never block a legitimate tool-gateway decision that already
      // completed its own authorization/rate-limit/dispatch logic.
    }
  }

  async resolveCredential(
    request: ToolgwResolveCredentialRequest,
  ): Promise<ToolgwResolveCredentialResponse> {
    try {
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
      await this.#auditCredentialResolution(request, "success");
      return {
        resolved_reference: token,
        expires_at: new Date(expiresAtMs).toISOString(),
      };
    } catch (error: unknown) {
      await this.#auditCredentialResolution(request, "error");
      throw error;
    }
  }

  async #auditCredentialResolution(
    request: ToolgwResolveCredentialRequest,
    result: "success" | "denied" | "error",
  ): Promise<void> {
    await this.#recordAuditEventBestEffort({
      tenant_id: request.tenant_id,
      actor_type: "service",
      actor_ref: "tool-gateway",
      action: "credential.resolve",
      target_type: "integration",
      target_ref: request.integration_id,
      result,
      reason_code: "",
      context_json: "{}",
      occurred_at: this.#now().toISOString(),
    });
  }

  async fetchUrl(
    request: ToolgwFetchUrlRequest,
  ): Promise<ToolgwFetchUrlResponse> {
    try {
      validateFetchUrlRequest(request);
      const { statusCode, body } = await this.urlFetcher.fetch(request.url);
      const artifactId = this.#storeArtifact(body);
      await this.#auditFetchUrl(request, "success");
      return { status_code: statusCode, content_artifact_id: artifactId };
    } catch (error: unknown) {
      await this.#auditFetchUrl(
        request,
        error instanceof SsrfBlockedError ? "denied" : "error",
      );
      throw error;
    }
  }

  async #auditFetchUrl(
    request: ToolgwFetchUrlRequest,
    result: "success" | "denied" | "error",
  ): Promise<void> {
    await this.#recordAuditEventBestEffort({
      tenant_id: request.tenant_id,
      actor_type: "service",
      actor_ref: "tool-gateway",
      action: "url.fetch",
      target_type: "url",
      target_ref: request.url,
      result,
      reason_code: "",
      context_json: JSON.stringify({
        runId: request.run_id,
        nodeExecutionId: request.node_execution_id,
      }),
      occurred_at: this.#now().toISOString(),
    });
  }

  #storeArtifact(body: ArrayBuffer): string {
    this.#sweepExpiredArtifacts();
    if (this.#artifacts.size >= this.#maxArtifacts) {
      const oldest = this.#oldestArtifactId();
      if (oldest !== undefined) {
        this.#artifacts.delete(oldest);
      }
    }
    const artifactId = `art_${this.#mintId()}`;
    this.#artifacts.set(artifactId, {
      body,
      expiresAtMs: this.#now().getTime() + this.#artifactTtlMs,
    });
    return artifactId;
  }

  #oldestArtifactId(): string | undefined {
    let oldestId: string | undefined;
    let oldestExpiresAtMs = Number.POSITIVE_INFINITY;
    for (const [id, record] of this.#artifacts.entries()) {
      if (record.expiresAtMs < oldestExpiresAtMs) {
        oldestId = id;
        oldestExpiresAtMs = record.expiresAtMs;
      }
    }
    return oldestId;
  }

  #sweepExpiredArtifacts(): void {
    const nowMs = this.#now().getTime();
    for (const [id, record] of this.#artifacts.entries()) {
      if (record.expiresAtMs <= nowMs) {
        this.#artifacts.delete(id);
      }
    }
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

function validateFetchUrlRequest(request: ToolgwFetchUrlRequest): void {
  requireNonEmpty(request.tenant_id, "tenant_id");
  requireNonEmpty(request.run_id, "run_id");
  requireNonEmpty(request.node_execution_id, "node_execution_id");
  requireNonEmpty(request.url, "url");
  try {
    // eslint-disable-next-line no-new -- validates the URL is well-formed
    new URL(request.url);
  } catch {
    throw new ToolGatewayValidationError("url must be a valid absolute URL");
  }
}

interface SearchWebInput {
  readonly query: string;
  readonly maxResults?: number;
}

function parseSearchWebInput(inputJson: string): SearchWebInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputJson);
  } catch {
    throw new ToolGatewayValidationError("input_json must be valid JSON");
  }
  const record = parsed as { readonly query?: unknown; readonly maxResults?: unknown };
  if (typeof record.query !== "string" || record.query.trim().length === 0) {
    throw new ToolGatewayValidationError(
      "search.web input_json must include a non-empty query string",
    );
  }
  if (
    record.maxResults !== undefined &&
    (typeof record.maxResults !== "number" ||
      !Number.isInteger(record.maxResults) ||
      record.maxResults < 1)
  ) {
    throw new ToolGatewayValidationError(
      "search.web input_json maxResults, if present, must be a positive integer",
    );
  }
  return {
    query: record.query,
    ...(record.maxResults === undefined
      ? {}
      : { maxResults: record.maxResults }),
  };
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
