import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  ErrorCapture,
  LogEntry,
  MetricPoint,
  ObservabilityProvider,
  ProviderHealth,
  ProviderMetadata,
  SecretsProvider,
  TraceSpan,
} from "@alterx/shared-clients";

import {
  OtelGrafanaProvider,
  type OtelGrafanaConfig,
  type OtelProviderDependencies,
} from "./otel-provider";
import {
  SentryErrorProvider,
  type SentryErrorConfig,
  type SentryProviderDependencies,
} from "./sentry-provider";

export interface ObservabilityAdapterConfig {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly environment: string;
  readonly grafanaInstanceId: string;
  readonly grafanaOtlpEndpointReference: string;
  readonly grafanaApiKeyReference: string;
  readonly sentryDsnReference: string;
}

export interface ManagedObservabilityProvider extends ObservabilityProvider {
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

interface OtelTelemetryProvider {
  start(): Promise<void>;
  emitTrace(span: TraceSpan): Promise<void>;
  emitMetric(metric: MetricPoint): Promise<void>;
  emitLog(entry: LogEntry): Promise<void>;
  healthCheck(): Promise<ProviderHealth>;
  shutdown(): Promise<void>;
}

interface SentryTelemetryProvider {
  start(): Promise<void>;
  captureError(error: ErrorCapture): Promise<void>;
  healthCheck(): Promise<ProviderHealth>;
  shutdown(): Promise<void>;
}

export interface ObservabilityProviderFactoryDependencies {
  readonly otel?: OtelProviderDependencies;
  readonly sentry?: SentryProviderDependencies;
  readonly createOtelProvider?: (
    config: OtelGrafanaConfig,
  ) => OtelTelemetryProvider;
  readonly createSentryProvider?: (
    config: SentryErrorConfig,
  ) => SentryTelemetryProvider;
  readonly now?: () => Date;
  readonly monotonicNow?: () => bigint;
}

export class ObservabilityConfigurationError extends Error {
  constructor(field: keyof ObservabilityAdapterConfig, reason = "must be non-empty") {
    super(`Observability config field ${field} ${reason}`);
    this.name = "ObservabilityConfigurationError";
  }
}

export const GRAFANA_SENTRY_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: [],
  data_residency: [],
  batch_support: true,
  maximum_payload: 1_048_576,
  supported_languages: [],
  cost_model: { rates: [] },
};

export const GRAFANA_SENTRY_METADATA: ProviderMetadata<"ObservabilityProvider"> =
  {
    providerId: "grafana-cloud-sentry",
    interfaceName: "ObservabilityProvider",
    displayName: "Grafana Cloud OTLP + Sentry",
    version: "foundation-v1",
    telemetryNamespace: "alterx.adapters.observability",
    supportsTenantOverrides: false,
    migration: {
      strategyVersion: "otel-sentry-v1",
      rollbackSupported: true,
    },
  };

function requireNonEmpty(
  field: keyof ObservabilityAdapterConfig,
  value: string,
): void {
  if (value.trim().length === 0) {
    throw new ObservabilityConfigurationError(field);
  }
}

function assertReference(
  field:
    | "grafanaOtlpEndpointReference"
    | "grafanaApiKeyReference"
    | "sentryDsnReference",
  reference: string,
): void {
  requireNonEmpty(field, reference);
  if (reference.trim() !== reference) {
    throw new ObservabilityConfigurationError(field, "must be trimmed");
  }
}

function assertResolvedSecret(field: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`Resolved observability secret ${field} contains no value`);
  }
}

function elapsedMilliseconds(startedAt: bigint, endedAt: bigint): number {
  return Number(endedAt - startedAt) / 1_000_000;
}

function combineHealthStatus(
  otel: ProviderHealth["status"],
  sentry: ProviderHealth["status"],
): ProviderHealth["status"] {
  if (otel === "unhealthy" || sentry === "unhealthy") {
    return "unhealthy";
  }
  if (otel === "degraded" || sentry === "degraded") {
    return "degraded";
  }
  return "healthy";
}

export class GrafanaSentryObservabilityProvider
  implements ManagedObservabilityProvider
{
  readonly metadata = GRAFANA_SENTRY_METADATA;
  readonly capabilities = GRAFANA_SENTRY_CAPABILITIES;

  readonly #otel: OtelTelemetryProvider;
  readonly #sentry: SentryTelemetryProvider;
  readonly #now: () => Date;
  readonly #monotonicNow: () => bigint;
  #started = false;

  constructor(
    otel: OtelTelemetryProvider,
    sentry: SentryTelemetryProvider,
    dependencies: Pick<
      ObservabilityProviderFactoryDependencies,
      "now" | "monotonicNow"
    > = {},
  ) {
    this.#otel = otel;
    this.#sentry = sentry;
    this.#now = dependencies.now ?? (() => new Date());
    this.#monotonicNow = dependencies.monotonicNow ?? process.hrtime.bigint;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    await this.#otel.start();
    try {
      await this.#sentry.start();
      this.#started = true;
    } catch (error: unknown) {
      await this.#otel.shutdown();
      throw error;
    }
  }

  emitTrace(span: TraceSpan): Promise<void> {
    return this.#otel.emitTrace(span);
  }

  emitMetric(metric: MetricPoint): Promise<void> {
    return this.#otel.emitMetric(metric);
  }

  emitLog(entry: LogEntry): Promise<void> {
    return this.#otel.emitLog(entry);
  }

  captureError(error: ErrorCapture): Promise<void> {
    return this.#sentry.captureError(error);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startedAt = this.#monotonicNow();
    const [otel, sentry] = await Promise.all([
      this.#otel.healthCheck(),
      this.#sentry.healthCheck(),
    ]);
    return {
      status: combineHealthStatus(otel.status, sentry.status),
      checkedAt: this.#now().toISOString(),
      latencyMs: elapsedMilliseconds(startedAt, this.#monotonicNow()),
      details: {
        started: this.#started,
        otlpStatus: otel.status,
        sentryStatus: sentry.status,
      },
    };
  }

  async shutdown(): Promise<void> {
    if (!this.#started) {
      return;
    }
    await Promise.allSettled([this.#otel.shutdown(), this.#sentry.shutdown()]);
    this.#started = false;
  }
}

export async function createObservabilityProvider(
  config: ObservabilityAdapterConfig,
  secretsProvider: SecretsProvider,
  dependencies: ObservabilityProviderFactoryDependencies = {},
): Promise<ManagedObservabilityProvider> {
  requireNonEmpty("serviceName", config.serviceName);
  requireNonEmpty("serviceVersion", config.serviceVersion);
  requireNonEmpty("environment", config.environment);
  requireNonEmpty("grafanaInstanceId", config.grafanaInstanceId);
  assertReference(
    "grafanaOtlpEndpointReference",
    config.grafanaOtlpEndpointReference,
  );
  assertReference("grafanaApiKeyReference", config.grafanaApiKeyReference);
  assertReference("sentryDsnReference", config.sentryDsnReference);

  const [endpoint, apiKey, dsn] = await Promise.all([
    secretsProvider.getSecret(config.grafanaOtlpEndpointReference),
    secretsProvider.getSecret(config.grafanaApiKeyReference),
    secretsProvider.getSecret(config.sentryDsnReference),
  ]);
  assertResolvedSecret("grafanaOtlpEndpointReference", endpoint);
  assertResolvedSecret("grafanaApiKeyReference", apiKey);
  assertResolvedSecret("sentryDsnReference", dsn);

  const authorizationHeader = `Basic ${Buffer.from(
    `${config.grafanaInstanceId}:${apiKey}`,
    "utf8",
  ).toString("base64")}`;
  const otelConfig: OtelGrafanaConfig = {
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
    endpoint,
    authorizationHeader,
  };
  const sentryConfig: SentryErrorConfig = {
    dsn,
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
    environment: config.environment,
  };
  const otel =
    dependencies.createOtelProvider?.(otelConfig) ??
    new OtelGrafanaProvider(otelConfig, dependencies.otel);
  const sentry =
    dependencies.createSentryProvider?.(sentryConfig) ??
    new SentryErrorProvider(sentryConfig, dependencies.sentry);
  return new GrafanaSentryObservabilityProvider(otel, sentry, dependencies);
}

export {
  OtelConfigurationError,
  OtelGrafanaProvider,
  type OtelEndpointProbe,
  type OtelEndpointProbeResult,
  type OtelGrafanaConfig,
  type OtelProviderDependencies,
} from "./otel-provider";
export {
  SentryConfigurationError,
  SentryErrorProvider,
  type SentryCaptureContext,
  type SentryErrorConfig,
  type SentryFacade,
  type SentryProviderDependencies,
} from "./sentry-provider";
export { startNodeSdkTracing, type NodeSdkTracingConfig } from "./node-sdk-tracing";
