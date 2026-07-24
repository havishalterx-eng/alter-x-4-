import type {
  Histogram,
  Meter,
  Span,
  Tracer,
} from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { tracing } from "@opentelemetry/sdk-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OtelConfigurationError,
  OtelGrafanaProvider,
  QueuedTraceIdGenerator,
  type OtelGrafanaConfig,
  type OtelProviderDependencies,
  type OtelRuntime,
} from "./otel-provider";

const CONFIG: OtelGrafanaConfig = {
  serviceName: "audit-service",
  serviceVersion: "1.0.0",
  endpoint: "https://otlp.example.invalid",
  authorizationHeader: "Basic [resolved-at-runtime]",
};

const TRACE_ID = "0123456789abcdef0123456789abcdef";
const SECOND_TRACE_ID = "abcdef0123456789abcdef0123456789";
const SPAN_ID = "0123456789abcdef";
const SECOND_SPAN_ID = "abcdef0123456789";

function dependencies(
  overrides: Partial<OtelProviderDependencies> = {},
): OtelProviderDependencies & {
  readonly runtime: OtelRuntime;
  readonly tracer: Tracer;
  readonly meter: Meter;
  readonly logger: Logger;
} {
  const span = { end: vi.fn() } as unknown as Span;
  const histogram = { record: vi.fn() } as unknown as Histogram;
  return {
    runtime: {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    },
    tracer: {
      startSpan: vi.fn().mockReturnValue(span),
    } as unknown as Tracer,
    meter: {
      createHistogram: vi.fn().mockReturnValue(histogram),
    } as unknown as Meter,
    logger: { emit: vi.fn() } as unknown as Logger,
    endpointProbe: vi.fn().mockResolvedValue({
      reachable: true,
      authorized: true,
      statusCode: 204,
    }),
    now: () => new Date("2026-07-24T00:00:00.000Z"),
    monotonicNow: () => 0n,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OtelGrafanaProvider mapping", () => {
  it("maps completed and open trace shapes onto OTel spans", async () => {
    const deps = dependencies();
    const provider = new OtelGrafanaProvider(CONFIG, deps);
    await provider.start();
    await provider.start();

    await provider.emitTrace({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: "audit.append",
      startedAt: "2026-07-24T00:00:00.000Z",
      endedAt: "2026-07-24T00:00:01.000Z",
      attributes: { tenant_present: true, attempt: 1 },
    });
    await provider.emitTrace({
      traceId: SECOND_TRACE_ID,
      spanId: SECOND_SPAN_ID,
      name: "audit.flush",
      startedAt: "2026-07-24T00:00:02.000Z",
    });

    expect(deps.runtime.start).toHaveBeenCalledOnce();
    expect(deps.tracer.startSpan).toHaveBeenNthCalledWith(
      1,
      "audit.append",
      expect.objectContaining({
        startTime: new Date("2026-07-24T00:00:00.000Z"),
        attributes: expect.objectContaining({
          "alterx.trace_id": TRACE_ID,
          "alterx.span_id": SPAN_ID,
          "alterx.started_at": "2026-07-24T00:00:00.000Z",
          "alterx.ended_at": "2026-07-24T00:00:01.000Z",
          tenant_present: true,
          attempt: 1,
        }),
      }),
      expect.anything(),
    );
    const firstSpan = vi.mocked(deps.tracer.startSpan).mock.results[0]?.value;
    const secondSpan = vi.mocked(deps.tracer.startSpan).mock.results[1]?.value;
    expect(firstSpan?.end).toHaveBeenCalledWith(
      new Date("2026-07-24T00:00:01.000Z"),
    );
    expect(secondSpan?.end).toHaveBeenCalledWith();
  });

  it("exports the caller trace and span IDs as the span's own real context", async () => {
    const exporter = new tracing.InMemorySpanExporter();
    const idGenerator = new QueuedTraceIdGenerator();
    const tracerProvider = new tracing.BasicTracerProvider({
      idGenerator,
      spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
    });
    const deps = dependencies({
      idGenerator,
      tracer: tracerProvider.getTracer("correlation-test"),
    });
    const provider = new OtelGrafanaProvider(CONFIG, deps);
    await provider.start();

    await provider.emitTrace({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: "audit.correlated",
      startedAt: "2026-07-24T00:00:00.000Z",
      endedAt: "2026-07-24T00:00:01.000Z",
    });
    await tracerProvider.forceFlush();

    const [exportedSpan] = exporter.getFinishedSpans();
    expect(exportedSpan?.spanContext().traceId).toBe(TRACE_ID);
    expect(exportedSpan?.spanContext().spanId).toBe(SPAN_ID);
    expect(exportedSpan?.parentSpanContext).toBeUndefined();
    await tracerProvider.shutdown();
  });

  it.each([
    ["trace ID", "trace-id", SPAN_ID],
    ["all-zero trace ID", "00000000000000000000000000000000", SPAN_ID],
    ["span ID", TRACE_ID, "span-id"],
    ["all-zero span ID", TRACE_ID, "0000000000000000"],
  ])("contains an invalid %s as an emission failure", async (_name, traceId, spanId) => {
    const deps = dependencies();
    const provider = new OtelGrafanaProvider(CONFIG, deps);
    await provider.start();

    await expect(
      provider.emitTrace({
        traceId,
        spanId,
        name: "invalid.context",
        startedAt: "2026-07-24T00:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
    expect(deps.tracer.startSpan).not.toHaveBeenCalled();
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "degraded",
      details: { emissionFailures: 1, lastFailureSignal: "trace" },
    });
  });

  it("maps metrics to cached histograms with labels and source time", async () => {
    const record = vi.fn();
    const deps = dependencies({
      meter: {
        createHistogram: vi
          .fn()
          .mockReturnValue({ record } as unknown as Histogram),
      } as unknown as Meter,
    });
    const provider = new OtelGrafanaProvider(CONFIG, deps);
    await provider.start();

    await provider.emitMetric({
      name: "audit.append.duration",
      value: 12,
      recordedAt: "2026-07-24T00:00:00.000Z",
      unit: "ms",
      labels: { result: "success" },
    });
    await provider.emitMetric({
      name: "audit.append.duration",
      value: 14,
      recordedAt: "2026-07-24T00:00:01.000Z",
      unit: "ms",
    });

    expect(deps.meter.createHistogram).toHaveBeenCalledOnce();
    expect(deps.meter.createHistogram).toHaveBeenCalledWith(
      "audit.append.duration",
      { unit: "ms" },
    );
    expect(record).toHaveBeenNthCalledWith(1, 12, {
      result: "success",
      "alterx.recorded_at": "2026-07-24T00:00:00.000Z",
    });
    expect(record).toHaveBeenNthCalledWith(2, 14, {
      "alterx.recorded_at": "2026-07-24T00:00:01.000Z",
    });
  });

  it.each([
    ["debug", 5],
    ["info", 9],
    ["warn", 13],
    ["error", 17],
  ] as const)("maps %s logs to OTel severity %s", async (severity, number) => {
    const deps = dependencies();
    const provider = new OtelGrafanaProvider(CONFIG, deps);
    await provider.start();

    await provider.emitLog({
      severity,
      message: "structured log",
      recordedAt: "2026-07-24T00:00:00.000Z",
      attributes: { attempt: 2 },
    });

    expect(deps.logger.emit).toHaveBeenCalledWith({
      severityNumber: number,
      severityText: severity.toUpperCase(),
      body: "structured log",
      timestamp: new Date("2026-07-24T00:00:00.000Z"),
      attributes: { attempt: 2 },
    });
  });
});

describe("OtelGrafanaProvider health and failure mode", () => {
  it("reports not-started, healthy, degraded auth, and unreachable states", async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ reachable: true, authorized: true, statusCode: 204 })
      .mockResolvedValueOnce({ reachable: true, authorized: false, statusCode: 401 })
      .mockResolvedValueOnce({ reachable: false, authorized: false });
    const deps = dependencies({ endpointProbe: probe });
    const provider = new OtelGrafanaProvider(CONFIG, deps);

    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "degraded",
      details: { started: false },
    });
    await provider.start();
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "healthy",
      details: { endpointStatusCode: 204 },
    });
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "degraded",
      details: { endpointAuthorized: false },
    });
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "unhealthy",
      details: { endpointReachable: false },
    });
  });

  it("uses real endpoint probe semantics without exposing authorization", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ status: 204 })
      .mockRejectedValueOnce(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const { endpointProbe, ...deps } = dependencies();
    expect(endpointProbe).toBeTypeOf("function");
    const provider = new OtelGrafanaProvider(CONFIG, deps);
    await provider.start();

    const degradedHealth = await provider.healthCheck();
    expect(degradedHealth).toMatchObject({
      status: "degraded",
    });
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "healthy",
    });
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "unhealthy",
    });
    expect(JSON.stringify(degradedHealth)).not.toContain(
      CONFIG.authorizationHeader,
    );
  });

  it("buffers mapping failures and degrades health instead of throwing", async () => {
    const deps = dependencies({
      tracer: {
        startSpan: vi.fn(() => {
          throw new Error("transient exporter setup failure");
        }),
      } as unknown as Tracer,
    });
    const provider = new OtelGrafanaProvider(CONFIG, deps);
    await provider.start();

    await expect(
      provider.emitTrace({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        name: "failure",
        startedAt: "2026-07-24T00:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "degraded",
      details: { emissionFailures: 1, lastFailureSignal: "trace" },
    });
  });

  it("drains runtime once and tolerates shutdown before start", async () => {
    const deps = dependencies();
    const provider = new OtelGrafanaProvider(CONFIG, deps);
    await provider.shutdown();
    await provider.start();
    await provider.shutdown();
    await provider.shutdown();
    expect(deps.runtime.shutdown).toHaveBeenCalledOnce();
  });
});

describe("OtelGrafanaProvider configuration", () => {
  it.each([
    ["serviceName", { serviceName: "" }],
    ["serviceVersion", { serviceVersion: " " }],
    ["endpoint", { endpoint: "" }],
    ["endpoint", { endpoint: "not-a-url" }],
    ["endpoint", { endpoint: "http://otlp.example.invalid" }],
    ["authorizationHeader", { authorizationHeader: "" }],
    ["healthTimeoutMs", { healthTimeoutMs: 0 }],
    ["metricExportIntervalMs", { metricExportIntervalMs: 1.5 }],
  ])("rejects invalid %s", (field, override) => {
    expect(
      () => new OtelGrafanaProvider({ ...CONFIG, ...override }, dependencies()),
    ).toThrow(OtelConfigurationError);
    expect(
      () => new OtelGrafanaProvider({ ...CONFIG, ...override }, dependencies()),
    ).toThrow(field);
  });

  it("constructs concrete OTLP exporters and NodeSDK by default", async () => {
    const provider = new OtelGrafanaProvider({
      ...CONFIG,
      healthTimeoutMs: 1,
      metricExportIntervalMs: 1,
    });

    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "degraded",
    });
    await provider.shutdown();
  });
});
