import type { ProviderCapabilities } from "@alterx/contracts";

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
export interface ModelProvider extends BaseProvider<"ModelProvider"> {}
export interface EmbeddingProvider
  extends BaseProvider<"EmbeddingProvider"> {}
export interface PIIRedactionProvider
  extends BaseProvider<"PIIRedactionProvider"> {}
export interface SearchProvider extends BaseProvider<"SearchProvider"> {}
export interface BrowserProvider extends BaseProvider<"BrowserProvider"> {}
export interface DeploymentProvider
  extends BaseProvider<"DeploymentProvider"> {}
export interface ObjectStorageProvider
  extends BaseProvider<"ObjectStorageProvider"> {}
export interface QueueProvider extends BaseProvider<"QueueProvider"> {}
export interface SandboxProvider extends BaseProvider<"SandboxProvider"> {}
export interface RepositoryProvider
  extends BaseProvider<"RepositoryProvider"> {}
export interface ConfigProvider extends BaseProvider<"ConfigProvider"> {}
export interface RelationalDatabaseProvider
  extends BaseProvider<"RelationalDatabaseProvider"> {}
export interface VectorStoreProvider
  extends BaseProvider<"VectorStoreProvider"> {}
export interface CacheProvider extends BaseProvider<"CacheProvider"> {}
export interface EventBusProvider extends BaseProvider<"EventBusProvider"> {}
export interface GPUComputeProvider
  extends BaseProvider<"GPUComputeProvider"> {}
export interface NetworkConnectivityProvider
  extends BaseProvider<"NetworkConnectivityProvider"> {}
export interface AuditStoreProvider
  extends BaseProvider<"AuditStoreProvider"> {}
