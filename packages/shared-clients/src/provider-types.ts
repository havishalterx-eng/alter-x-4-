import type {
  FallbackBinding,
  ModelAlias,
  ModelAliasBinding,
  ProviderCapabilities,
} from "@alterx/contracts";

export const CANONICAL_PROVIDER_INTERFACES = [
  "DurableExecutionProvider",
  "ComputeProvider",
  "IdentityProvider",
  "ModelProvider",
  "EmbeddingProvider",
  "PIIRedactionProvider",
  "SearchProvider",
  "BrowserProvider",
  "DeploymentProvider",
  "ObjectStorageProvider",
  "QueueProvider",
  "SecretsProvider",
  "ObservabilityProvider",
  "SandboxProvider",
  "RepositoryProvider",
  "ConfigProvider",
  "RelationalDatabaseProvider",
  "VectorStoreProvider",
  "CacheProvider",
  "EventBusProvider",
  "GPUComputeProvider",
  "NetworkConnectivityProvider",
  "AuditStoreProvider",
] as const;

export type CanonicalProviderInterfaceName =
  (typeof CANONICAL_PROVIDER_INTERFACES)[number];

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface MigrationSupport {
  readonly strategyVersion: string;
  readonly rollbackSupported: boolean;
}

export interface ProviderMetadata<
  TInterface extends CanonicalProviderInterfaceName = CanonicalProviderInterfaceName,
> {
  readonly providerId: string;
  readonly interfaceName: TInterface;
  readonly displayName: string;
  readonly version: string;
  readonly telemetryNamespace: string;
  readonly featureFlag?: string;
  readonly supportsTenantOverrides: boolean;
  readonly migration: MigrationSupport;
}

export interface ProviderHealth {
  readonly status: HealthStatus;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export interface BaseProvider<
  TInterface extends CanonicalProviderInterfaceName = CanonicalProviderInterfaceName,
> {
  readonly metadata: ProviderMetadata<TInterface>;
  readonly capabilities: ProviderCapabilities;
  healthCheck(): Promise<ProviderHealth>;
}

export type SecretReferenceId = string;

export interface SecretsProvider extends BaseProvider<"SecretsProvider"> {
  getSecret(referenceId: SecretReferenceId): Promise<string>;
}

export interface MutableSecretsProvider extends SecretsProvider {
  putSecret(referenceId: SecretReferenceId, value: string): Promise<void>;
  deleteSecret(referenceId: SecretReferenceId): Promise<void>;
}

export interface TraceSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly name: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface MetricPoint {
  readonly name: string;
  readonly value: number;
  readonly recordedAt: string;
  readonly unit?: string;
  readonly labels?: Readonly<Record<string, string>>;
}

export interface LogEntry {
  readonly severity: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly recordedAt: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface ErrorCapture {
  readonly name: string;
  readonly message: string;
  readonly occurredAt: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface ObservabilityProvider
  extends BaseProvider<"ObservabilityProvider"> {
  emitTrace(span: TraceSpan): Promise<void>;
  emitMetric(metric: MetricPoint): Promise<void>;
  emitLog(entry: LogEntry): Promise<void>;
  captureError(error: ErrorCapture): Promise<void>;
}

export interface StartWorkflowRequest {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly input: JsonValue;
}

export interface DurableWorkflowHandle {
  readonly workflowId: string;
  readonly runId: string;
}

export interface SignalWorkflowRequest {
  readonly workflowId: string;
  readonly signalName: string;
  readonly payload: JsonValue;
}

export interface WorkflowQueryRequest {
  readonly workflowId: string;
  readonly queryName: "input" | "signals" | "status";
}

export interface WorkflowQueryResult {
  readonly workflowId: string;
  readonly queryName: WorkflowQueryRequest["queryName"];
  readonly value: JsonValue;
}

export interface TerminateWorkflowRequest {
  readonly workflowId: string;
  readonly reason: string;
}

export interface DurableExecutionProvider
  extends BaseProvider<"DurableExecutionProvider"> {
  startWorkflow(request: StartWorkflowRequest): Promise<DurableWorkflowHandle>;
  signalWorkflow(request: SignalWorkflowRequest): Promise<void>;
  queryWorkflow(request: WorkflowQueryRequest): Promise<WorkflowQueryResult>;
  terminateWorkflow(request: TerminateWorkflowRequest): Promise<void>;
}

export interface ComputeProvider extends BaseProvider<"ComputeProvider"> {}
export interface IdentityProvider extends BaseProvider<"IdentityProvider"> {}

export interface ModelInvocationRequest {
  readonly tenantId: string;
  readonly runId: string;
  readonly nodeExecutionId: string;
  readonly modelId: string;
  readonly capabilityTags: readonly string[];
  readonly inputJson: string;
  // Ordered fallback providers to try, in order, only after modelId (the
  // primary, Bedrock-hosted model) fails. Empty/absent = no failover.
  readonly fallbackChain?: readonly FallbackBinding[];
}

export interface ModelInvocationResult {
  readonly outputJson: string;
  readonly usageJson: string;
  // The providerId (BaseProvider.metadata.providerId) that actually served
  // this invocation -- the primary adapter, or whichever fallbackChain
  // entry succeeded. Never silently absent: callers must always be able to
  // see whether a downgrade happened.
  readonly servedBy: string;
}

export interface ModelProvider extends BaseProvider<"ModelProvider"> {
  invoke(request: ModelInvocationRequest): Promise<ModelInvocationResult>;
}

export type EmbeddingDimensions = 512 | 1024;

export interface EmbeddingRequest {
  readonly tenantId: string;
  readonly text: string;
  readonly dimensions: EmbeddingDimensions;
}

export interface EmbeddingResult {
  readonly vector: readonly number[];
  readonly dimensions: EmbeddingDimensions;
  readonly modelId: string;
}

export interface EmbeddingProvider extends BaseProvider<"EmbeddingProvider"> {
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}
export interface PIIDetectedEntity {
  readonly entityType: string;
  readonly start: number;
  readonly end: number;
  readonly score: number;
}

export interface PIIRedactionRequest {
  readonly tenantId: string;
  readonly text: string;
}

export interface PIIRedactionResult {
  readonly redactedText: string;
  readonly entities: readonly PIIDetectedEntity[];
}

export interface PIIRedactionProvider
  extends BaseProvider<"PIIRedactionProvider"> {
  redact(request: PIIRedactionRequest): Promise<PIIRedactionResult>;
}
export interface SearchRequest {
  readonly tenantId: string;
  readonly query: string;
  readonly maxResults?: number;
}

export interface SearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly score: number;
}

export interface SearchResult {
  readonly results: readonly SearchResultItem[];
}

export interface SearchProvider extends BaseProvider<"SearchProvider"> {
  search(request: SearchRequest): Promise<SearchResult>;
}
export interface BrowserProvider extends BaseProvider<"BrowserProvider"> {}
export interface DeploymentProvider
  extends BaseProvider<"DeploymentProvider"> {}
export interface ObjectStorageProvider
  extends BaseProvider<"ObjectStorageProvider"> {}
export interface QueueProvider extends BaseProvider<"QueueProvider"> {
  publish(queueName: string, message: JsonValue): Promise<void>;
  consume(queueName: string): Promise<JsonValue | undefined>;
}
export interface SandboxProvider extends BaseProvider<"SandboxProvider"> {}
export interface RepositoryProvider
  extends BaseProvider<"RepositoryProvider"> {}
export class ModelAliasResolutionError extends Error {
  constructor(alias: string) {
    super(`Model alias policy has no binding for alias: ${alias}`);
    this.name = "ModelAliasResolutionError";
  }
}

export class InvalidModelAliasError extends Error {
  constructor(alias: string) {
    super(`model_alias is not a recognized alias tier: ${alias}`);
    this.name = "InvalidModelAliasError";
  }
}

export interface ToolPermissionRequest {
  readonly tenantId: string;
  readonly toolName: string;
}

export interface ToolPermissionBinding {
  readonly allowed: boolean;
  readonly rateLimitPerMinute: number;
  readonly requiredScopes: readonly string[];
}

export interface CostLimitRequest {
  readonly tenantId: string;
  readonly runId: string;
}

export interface CostLimitBinding {
  readonly maxTokensPerCall: number;
  readonly maxCostUsdPerCall: number;
}

export interface ConfigProvider extends BaseProvider<"ConfigProvider"> {
  resolveModelAlias(alias: ModelAlias): Promise<ModelAliasBinding>;
  resolveToolPermission(
    request: ToolPermissionRequest,
  ): Promise<ToolPermissionBinding>;
  resolveCostLimit(request: CostLimitRequest): Promise<CostLimitBinding>;
}

export class ModelGatewayCostLimitExceededError extends Error {
  constructor(reason: string) {
    super(`Model invocation exceeded its resolved cost limit: ${reason}`);
    this.name = "ModelGatewayCostLimitExceededError";
  }
}

export class ModelGatewayInvalidResponseError extends Error {
  constructor(reason: string) {
    super(`Model response failed validation: ${reason}`);
    this.name = "ModelGatewayInvalidResponseError";
  }
}
export interface RelationalDatabaseProvider
  extends BaseProvider<"RelationalDatabaseProvider"> {}
export interface VectorStoreProvider
  extends BaseProvider<"VectorStoreProvider"> {}
export interface SemanticCacheLookupRequest {
  readonly tenantId: string;
  readonly embedding: readonly number[];
  readonly similarityThreshold?: number;
}

export interface SemanticCacheLookupResult {
  readonly hit: boolean;
  readonly valueJson?: string;
  readonly similarity?: number;
}

export interface SemanticCacheStoreRequest {
  readonly tenantId: string;
  readonly embedding: readonly number[];
  readonly valueJson: string;
  readonly ttlSeconds?: number;
}

export interface CacheProvider extends BaseProvider<"CacheProvider"> {
  lookupSemantic(
    request: SemanticCacheLookupRequest,
  ): Promise<SemanticCacheLookupResult>;
  storeSemantic(request: SemanticCacheStoreRequest): Promise<void>;
}
export interface EventBusProvider extends BaseProvider<"EventBusProvider"> {}
export interface GPUComputeProvider
  extends BaseProvider<"GPUComputeProvider"> {}
export interface NetworkConnectivityProvider
  extends BaseProvider<"NetworkConnectivityProvider"> {}
