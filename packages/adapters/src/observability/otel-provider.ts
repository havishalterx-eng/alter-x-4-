import {
  isSpanContextValid,
  metrics,
  ROOT_CONTEXT,
  SpanKind,
  TraceFlags,
  trace,
  type Attributes,
  type Histogram,
  type Meter,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import {
  logs,
  SeverityNumber,
  type LogRecord,
  type Logger,
} from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK, tracing } from "@opentelemetry/sdk-node";

import type {
  LogEntry,
  MetricPoint,
  ProviderHealth,
  TraceSpan,
} from "@alterx/shared-clients";

const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 60_000;

const SEVERITY_NUMBERS: Readonly<Record<LogEntry["severity"], SeverityNumber>> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export interface OtelGrafanaConfig {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly endpoint: string;
  readonly authorizationHeader: string;
  readonly healthTimeoutMs?: number;
  readonly metricExportIntervalMs?: number;
}

export interface OtelRuntime {
  start(): void | Promise<void>;
  shutdown(): Promise<void>;
}

export interface OtelEndpointProbeResult {
  readonly reachable: boolean;
  readonly authorized: boolean;
  readonly statusCode?: number;
}

export type OtelEndpointProbe = (
  endpoint: string,
  authorizationHeader: string,
  timeoutMs: number,
) => Promise<OtelEndpointProbeResult>;

export interface OtelProviderDependencies {
  readonly runtime?: OtelRuntime;
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  readonly logger?: Logger;
  readonly idGenerator?: QueuedTraceIdGenerator;
  readonly endpointProbe?: OtelEndpointProbe;
  readonly now?: () => Date;
  readonly monotonicNow?: () => bigint;
}

export class OtelConfigurationError extends Error {
  constructor(field: keyof OtelGrafanaConfig, reason = "must be non-empty") {
    super(`OpenTelemetry config field ${field} ${reason}`);
    this.name = "OtelConfigurationError";
  }
}

function requireNonEmpty(
  field: keyof OtelGrafanaConfig,
  value: string,
): void {
  if (value.trim().length === 0) {
    throw new OtelConfigurationError(field);
  }
}

function signalUrl(endpoint: string, signal: "traces" | "metrics" | "logs"): string {
  return `${endpoint.replace(/\/$/, "")}/v1/${signal}`;
}

function defaultRuntime(
  config: OtelGrafanaConfig,
  idGenerator: QueuedTraceIdGenerator,
): OtelRuntime {
  const headers = { Authorization: config.authorizationHeader };
  return new NodeSDK({
    serviceName: config.serviceName,
    idGenerator,
    traceExporter: new OTLPTraceExporter({
      url: signalUrl(config.endpoint, "traces"),
      headers,
    }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: signalUrl(config.endpoint, "metrics"),
          headers,
        }),
        exportIntervalMillis:
          config.metricExportIntervalMs ?? DEFAULT_METRIC_EXPORT_INTERVAL_MS,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: signalUrl(config.endpoint, "logs"),
          headers,
        }),
      }),
    ],
  });
}

async function defaultEndpointProbe(
  endpoint: string,
  authorizationHeader: string,
  timeoutMs: number,
): Promise<OtelEndpointProbeResult> {
  try {
    const response = await fetch(signalUrl(endpoint, "traces"), {
      method: "HEAD",
      headers: { Authorization: authorizationHeader },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      reachable: response.status < 500,
      authorized: response.status !== 401 && response.status !== 403,
      statusCode: response.status,
    };
  } catch {
    return { reachable: false, authorized: false };
  }
}

function elapsedMilliseconds(startedAt: bigint, endedAt: bigint): number {
  return Number(endedAt - startedAt) / 1_000_000;
}

function telemetryAttributes(
  attributes: Readonly<Record<string, string | number | boolean>> | undefined,
): Attributes {
  return attributes === undefined ? {} : { ...attributes };
}

function assertValidTraceIds(input: TraceSpan): void {
  const spanContext = {
    traceId: input.traceId,
    spanId: input.spanId,
    traceFlags: TraceFlags.SAMPLED,
  };
  if (
    !/^[0-9a-f]{32}$/.test(input.traceId) ||
    !/^[0-9a-f]{16}$/.test(input.spanId) ||
    !isSpanContextValid(spanContext)
  ) {
    throw new TypeError(
      "TraceSpan requires a valid lowercase 32-hex traceId and 16-hex spanId",
    );
  }
}

export class QueuedTraceIdGenerator {
  readonly #fallback = new tracing.RandomIdGenerator();
  #pending:
    | {
        readonly traceId: string;
        readonly spanId: string;
        traceIdGenerated: boolean;
        spanIdGenerated: boolean;
      }
    | undefined;

  queue(traceId: string, spanId: string): void {
    if (this.#pending !== undefined) {
      throw new Error("An OpenTelemetry trace ID pair is already pending");
    }
    this.#pending = {
      traceId,
      spanId,
      traceIdGenerated: false,
      spanIdGenerated: false,
    };
  }

  generateTraceId(): string {
    const pending = this.#pending;
    if (pending === undefined) {
      return this.#fallback.generateTraceId();
    }
    pending.traceIdGenerated = true;
    const traceId = pending.traceId;
    this.#clearWhenConsumed(pending);
    return traceId;
  }

  generateSpanId(): string {
    const pending = this.#pending;
    if (pending === undefined) {
      return this.#fallback.generateSpanId();
    }
    pending.spanIdGenerated = true;
    const spanId = pending.spanId;
    this.#clearWhenConsumed(pending);
    return spanId;
  }

  clearPending(): void {
    this.#pending = undefined;
  }

  #clearWhenConsumed(pending: {
    readonly traceIdGenerated: boolean;
    readonly spanIdGenerated: boolean;
  }): void {
    if (pending.traceIdGenerated && pending.spanIdGenerated) {
      this.#pending = undefined;
    }
  }
}

export class OtelGrafanaProvider {
  readonly #config: OtelGrafanaConfig;
  readonly #runtime: OtelRuntime;
  readonly #tracer: Tracer;
  readonly #meter: Meter;
  readonly #logger: Logger;
  readonly #idGenerator: QueuedTraceIdGenerator;
  readonly #endpointProbe: OtelEndpointProbe;
  readonly #now: () => Date;
  readonly #monotonicNow: () => bigint;
  readonly #histograms = new Map<string, Histogram>();
  #started = false;
  #emissionFailures = 0;
  #lastFailureSignal: "trace" | "metric" | "log" | undefined;

  constructor(
    config: OtelGrafanaConfig,
    dependencies: OtelProviderDependencies = {},
  ) {
    requireNonEmpty("serviceName", config.serviceName);
    requireNonEmpty("serviceVersion", config.serviceVersion);
    requireNonEmpty("endpoint", config.endpoint);
    requireNonEmpty("authorizationHeader", config.authorizationHeader);
    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(config.endpoint);
    } catch {
      throw new OtelConfigurationError("endpoint", "must be a valid URL");
    }
    if (parsedEndpoint.protocol !== "https:") {
      throw new OtelConfigurationError("endpoint", "must use HTTPS");
    }
    if (
      config.healthTimeoutMs !== undefined &&
      (!Number.isInteger(config.healthTimeoutMs) || config.healthTimeoutMs < 1)
    ) {
      throw new OtelConfigurationError(
        "healthTimeoutMs",
        "must be a positive integer",
      );
    }
    if (
      config.metricExportIntervalMs !== undefined &&
      (!Number.isInteger(config.metricExportIntervalMs) ||
        config.metricExportIntervalMs < 1)
    ) {
      throw new OtelConfigurationError(
        "metricExportIntervalMs",
        "must be a positive integer",
      );
    }

    this.#config = Object.freeze({ ...config });
    this.#idGenerator =
      dependencies.idGenerator ?? new QueuedTraceIdGenerator();
    this.#runtime =
      dependencies.runtime ?? defaultRuntime(config, this.#idGenerator);
    this.#tracer =
      dependencies.tracer ??
      trace.getTracer(config.serviceName, config.serviceVersion);
    this.#meter =
      dependencies.meter ??
      metrics.getMeter(config.serviceName, config.serviceVersion);
    this.#logger =
      dependencies.logger ??
      logs.getLogger(config.serviceName, config.serviceVersion);
    this.#endpointProbe = dependencies.endpointProbe ?? defaultEndpointProbe;
    this.#now = dependencies.now ?? (() => new Date());
    this.#monotonicNow = dependencies.monotonicNow ?? process.hrtime.bigint;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    await this.#runtime.start();
    this.#started = true;
  }

  async emitTrace(input: TraceSpan): Promise<void> {
    this.#emitSafely("trace", () => {
      this.#assertStarted();
      assertValidTraceIds(input);
      const attributes: Attributes = {
        ...telemetryAttributes(input.attributes),
        "alterx.trace_id": input.traceId,
        "alterx.span_id": input.spanId,
        "alterx.started_at": input.startedAt,
        ...(input.endedAt === undefined
          ? {}
          : { "alterx.ended_at": input.endedAt }),
      };
      this.#idGenerator.queue(input.traceId, input.spanId);
      let span: Span;
      try {
        span = this.#tracer.startSpan(
          input.name,
          {
            kind: SpanKind.INTERNAL,
            startTime: new Date(input.startedAt),
            attributes,
          },
          ROOT_CONTEXT,
        );
      } finally {
        this.#idGenerator.clearPending();
      }
      if (input.endedAt === undefined) {
        span.end();
      } else {
        span.end(new Date(input.endedAt));
      }
    });
  }

  async emitMetric(input: MetricPoint): Promise<void> {
    this.#emitSafely("metric", () => {
      this.#assertStarted();
      const instrumentKey = `${input.name}\u0000${input.unit ?? ""}`;
      let histogram = this.#histograms.get(instrumentKey);
      if (histogram === undefined) {
        histogram = this.#meter.createHistogram(input.name, {
          ...(input.unit === undefined ? {} : { unit: input.unit }),
        });
        this.#histograms.set(instrumentKey, histogram);
      }
      histogram.record(input.value, {
        ...(input.labels ?? {}),
        "alterx.recorded_at": input.recordedAt,
      });
    });
  }

  async emitLog(input: LogEntry): Promise<void> {
    this.#emitSafely("log", () => {
      this.#assertStarted();
      const record: LogRecord = {
        severityNumber: SEVERITY_NUMBERS[input.severity],
        severityText: input.severity.toUpperCase(),
        body: input.message,
        timestamp: new Date(input.recordedAt),
        attributes: telemetryAttributes(input.attributes),
      };
      this.#logger.emit(record);
    });
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startedAt = this.#monotonicNow();
    const checkedAt = this.#now().toISOString();
    if (!this.#started) {
      return {
        status: "degraded",
        checkedAt,
        latencyMs: elapsedMilliseconds(startedAt, this.#monotonicNow()),
        details: { started: false },
      };
    }

    const probe = await this.#endpointProbe(
      this.#config.endpoint,
      this.#config.authorizationHeader,
      this.#config.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
    );
    const status = !probe.reachable
      ? "unhealthy"
      : !probe.authorized || this.#emissionFailures > 0
        ? "degraded"
        : "healthy";
    return {
      status,
      checkedAt,
      latencyMs: elapsedMilliseconds(startedAt, this.#monotonicNow()),
      details: {
        endpointReachable: probe.reachable,
        endpointAuthorized: probe.authorized,
        ...(probe.statusCode === undefined
          ? {}
          : { endpointStatusCode: probe.statusCode }),
        emissionFailures: this.#emissionFailures,
        ...(this.#lastFailureSignal === undefined
          ? {}
          : { lastFailureSignal: this.#lastFailureSignal }),
      },
    };
  }

  async shutdown(): Promise<void> {
    if (!this.#started) {
      return;
    }
    await this.#runtime.shutdown();
    this.#started = false;
  }

  #assertStarted(): void {
    if (!this.#started) {
      throw new Error("OpenTelemetry provider has not started");
    }
  }

  #emitSafely(
    signal: "trace" | "metric" | "log",
    emission: () => void,
  ): void {
    try {
      emission();
    } catch {
      this.#emissionFailures += 1;
      this.#lastFailureSignal = signal;
    }
  }
}
