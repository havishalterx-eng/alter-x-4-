import type { Meter, Span, Tracer } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";
import { describe, expect, it, vi } from "vitest";

import {
  assertProviderContractParity,
  createMockSecretsProvider,
  observabilityProviderContract,
  type ErrorCapture,
  type LogEntry,
  type MetricPoint,
  type ProviderHealth,
  type SecretsProvider,
  type TraceSpan,
} from "@alterx/shared-clients";

import {
  GrafanaSentryObservabilityProvider,
  ObservabilityConfigurationError,
  createObservabilityProvider,
  type ObservabilityAdapterConfig,
  type ObservabilityProviderFactoryDependencies,
} from "./index";
import type { OtelRuntime } from "./otel-provider";
import type { SentryFacade } from "./sentry-provider";

const REFERENCES = {
  endpoint: "/alter/test/observability/grafana/otlp-endpoint",
  apiKey: "/alter/test/observability/grafana/api-key",
  sentryDsn: "/alter/test/observability/sentry/dsn",
} as const;

const CONFIG: ObservabilityAdapterConfig = {
  serviceName: "audit-service",
  serviceVersion: "1.0.0",
  environment: "test",
  grafanaInstanceId: "123456",
  grafanaOtlpEndpointReference: REFERENCES.endpoint,
  grafanaApiKeyReference: REFERENCES.apiKey,
  sentryDsnReference: REFERENCES.sentryDsn,
};

function secrets(): SecretsProvider {
  return createMockSecretsProvider({
    secrets: {
      [REFERENCES.endpoint]: "https://otlp.example.invalid",
      [REFERENCES.apiKey]: "[resolved-grafana-api-key]",
      [REFERENCES.sentryDsn]: "https://[resolved]@sentry.example.invalid/1",
    },
  });
}

function trackedSecrets() {
  const inner = secrets();
  const getSecret = vi.fn<SecretsProvider["getSecret"]>((reference) =>
    inner.getSecret(reference),
  );
  return {
    provider: { ...inner, getSecret },
    getSecret,
  };
}

function providerDependencies(): ObservabilityProviderFactoryDependencies & {
  readonly runtime: OtelRuntime;
  readonly sentryFacade: SentryFacade;
} {
  const runtime: OtelRuntime = {
    start: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  const sentryFacade: SentryFacade = {
    init: vi.fn(),
    captureException: vi.fn(() => "event-id"),
    flush: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(true),
  };
  const span = { end: vi.fn() } as unknown as Span;
  return {
    runtime,
    sentryFacade,
    otel: {
      runtime,
      tracer: {
        startSpan: vi.fn(() => span),
      } as unknown as Tracer,
      meter: {
        createHistogram: vi.fn(() => ({ record: vi.fn() })),
      } as unknown as Meter,
      logger: { emit: vi.fn() } as unknown as Logger,
      endpointProbe: vi.fn().mockResolvedValue({
        reachable: true,
        authorized: true,
        statusCode: 204,
      }),
      now: () => new Date("1970-01-01T00:00:00.000Z"),
      monotonicNow: () => 0n,
    },
    sentry: {
      facade: sentryFacade,
      now: () => new Date("1970-01-01T00:00:00.000Z"),
      monotonicNow: () => 0n,
    },
    now: () => new Date("1970-01-01T00:00:00.000Z"),
    monotonicNow: () => 0n,
  };
}

async function startedProvider() {
  const provider = await createObservabilityProvider(
    CONFIG,
    secrets(),
    providerDependencies(),
  );
  await provider.start();
  return provider;
}

function health(status: ProviderHealth["status"]): ProviderHealth {
  return {
    status,
    checkedAt: "1970-01-01T00:00:00.000Z",
    latencyMs: 0,
  };
}

function subproviders(options: {
  readonly otelStatus?: ProviderHealth["status"];
  readonly sentryStatus?: ProviderHealth["status"];
  readonly sentryStart?: () => Promise<void>;
  readonly otelShutdown?: () => Promise<void>;
  readonly sentryShutdown?: () => Promise<void>;
} = {}) {
  return {
    otel: {
      start: vi.fn().mockResolvedValue(undefined),
      emitTrace: vi.fn().mockResolvedValue(undefined),
      emitMetric: vi.fn().mockResolvedValue(undefined),
      emitLog: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi
        .fn()
        .mockResolvedValue(health(options.otelStatus ?? "healthy")),
      shutdown:
        options.otelShutdown ?? vi.fn().mockResolvedValue(undefined),
    },
    sentry: {
      start:
        options.sentryStart ?? vi.fn().mockResolvedValue(undefined),
      captureError: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi
        .fn()
        .mockResolvedValue(health(options.sentryStatus ?? "healthy")),
      shutdown:
        options.sentryShutdown ?? vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("createObservabilityProvider", () => {
  it("resolves Grafana and Sentry values only through SecretsProvider references", async () => {
    const secretProvider = trackedSecrets();
    let otelAuthorization = "";
    let sentryDsn = "";
    const parts = subproviders();

    const provider = await createObservabilityProvider(CONFIG, secretProvider.provider, {
      createOtelProvider: (config) => {
        otelAuthorization = config.authorizationHeader;
        return parts.otel;
      },
      createSentryProvider: (config) => {
        sentryDsn = config.dsn;
        return parts.sentry;
      },
    });

    expect(secretProvider.getSecret.mock.calls.map(([reference]) => reference)).toEqual([
      REFERENCES.endpoint,
      REFERENCES.apiKey,
      REFERENCES.sentryDsn,
    ]);
    expect(otelAuthorization).toMatch(/^Basic /);
    expect(otelAuthorization).not.toContain("[resolved-grafana-api-key]");
    expect(sentryDsn).toBe("https://[resolved]@sentry.example.invalid/1");
    expect(JSON.stringify(provider)).not.toContain("resolved-grafana-api-key");
    expect(JSON.stringify(provider)).not.toContain("sentry.example.invalid");
  });

  it("fails startup when a secret reference is missing or resolves empty", async () => {
    const missing = createMockSecretsProvider({
      secrets: {
        [REFERENCES.endpoint]: "https://otlp.example.invalid",
        [REFERENCES.apiKey]: "[resolved-grafana-api-key]",
      },
    });
    await expect(
      createObservabilityProvider(CONFIG, missing, providerDependencies()),
    ).rejects.toThrow(/not found/);

    const empty = createMockSecretsProvider({
      secrets: {
        [REFERENCES.endpoint]: "https://otlp.example.invalid",
        [REFERENCES.apiKey]: "",
        [REFERENCES.sentryDsn]: "https://[resolved]@sentry.example.invalid/1",
      },
    });
    await expect(
      createObservabilityProvider(CONFIG, empty, providerDependencies()),
    ).rejects.toThrow("grafanaApiKeyReference contains no value");
  });

  it.each([
    ["serviceName", { serviceName: "" }],
    ["serviceVersion", { serviceVersion: "" }],
    ["environment", { environment: " " }],
    ["grafanaInstanceId", { grafanaInstanceId: "" }],
    ["grafanaOtlpEndpointReference", { grafanaOtlpEndpointReference: "" }],
    ["grafanaApiKeyReference", { grafanaApiKeyReference: " bad " }],
    ["sentryDsnReference", { sentryDsnReference: "" }],
  ])("rejects invalid %s before secret resolution", async (field, override) => {
    const secretProvider = trackedSecrets();
    await expect(
      createObservabilityProvider(
        { ...CONFIG, ...override },
        secretProvider.provider,
        providerDependencies(),
      ),
    ).rejects.toBeInstanceOf(ObservabilityConfigurationError);
    expect(secretProvider.getSecret).not.toHaveBeenCalled();
    await expect(
      createObservabilityProvider(
        { ...CONFIG, ...override },
        secretProvider.provider,
        providerDependencies(),
      ),
    ).rejects.toThrow(field);
  });
});

describe("GrafanaSentryObservabilityProvider", () => {
  it("delegates all port operations and drains both providers", async () => {
    const parts = subproviders();
    const provider = new GrafanaSentryObservabilityProvider(
      parts.otel,
      parts.sentry,
      {
        now: () => new Date("1970-01-01T00:00:00.000Z"),
        monotonicNow: () => 0n,
      },
    );
    const traceInput: TraceSpan = {
      traceId: "trace-1",
      spanId: "span-1",
      name: "trace",
      startedAt: "2026-07-24T00:00:00.000Z",
    };
    const metricInput: MetricPoint = {
      name: "metric",
      value: 1,
      recordedAt: "2026-07-24T00:00:00.000Z",
    };
    const logInput: LogEntry = {
      severity: "info",
      message: "log",
      recordedAt: "2026-07-24T00:00:00.000Z",
    };
    const errorInput: ErrorCapture = {
      name: "Error",
      message: "error",
      occurredAt: "2026-07-24T00:00:00.000Z",
    };

    await provider.start();
    await provider.start();
    await provider.emitTrace(traceInput);
    await provider.emitMetric(metricInput);
    await provider.emitLog(logInput);
    await provider.captureError(errorInput);
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "healthy",
      details: { started: true, otlpStatus: "healthy", sentryStatus: "healthy" },
    });
    await provider.shutdown();
    await provider.shutdown();

    expect(parts.otel.start).toHaveBeenCalledOnce();
    expect(parts.sentry.start).toHaveBeenCalledOnce();
    expect(parts.otel.emitTrace).toHaveBeenCalledWith(traceInput);
    expect(parts.otel.emitMetric).toHaveBeenCalledWith(metricInput);
    expect(parts.otel.emitLog).toHaveBeenCalledWith(logInput);
    expect(parts.sentry.captureError).toHaveBeenCalledWith(errorInput);
    expect(parts.otel.shutdown).toHaveBeenCalledOnce();
    expect(parts.sentry.shutdown).toHaveBeenCalledOnce();
  });

  it.each([
    ["degraded", "healthy", "degraded"],
    ["healthy", "degraded", "degraded"],
    ["unhealthy", "healthy", "unhealthy"],
    ["healthy", "unhealthy", "unhealthy"],
  ] as const)(
    "combines OTel %s and Sentry %s as %s",
    async (otelStatus, sentryStatus, expected) => {
      const parts = subproviders({ otelStatus, sentryStatus });
      const provider = new GrafanaSentryObservabilityProvider(
        parts.otel,
        parts.sentry,
      );
      await expect(provider.healthCheck()).resolves.toMatchObject({
        status: expected,
      });
    },
  );

  it("rolls OTel back when Sentry startup fails", async () => {
    const failure = new Error("Sentry init failed");
    const otelShutdown = vi.fn().mockResolvedValue(undefined);
    const parts = subproviders({
      sentryStart: vi.fn().mockRejectedValue(failure),
      otelShutdown,
    });
    const provider = new GrafanaSentryObservabilityProvider(
      parts.otel,
      parts.sentry,
    );

    await expect(provider.start()).rejects.toBe(failure);
    expect(otelShutdown).toHaveBeenCalledOnce();
  });

  it("settles shutdown exporter failures without crashing process", async () => {
    const parts = subproviders({
      otelShutdown: vi.fn().mockRejectedValue(new Error("OTLP drain failed")),
      sentryShutdown: vi
        .fn()
        .mockRejectedValue(new Error("Sentry drain failed")),
    });
    const provider = new GrafanaSentryObservabilityProvider(
      parts.otel,
      parts.sentry,
    );
    await provider.start();

    await expect(provider.shutdown()).resolves.toBeUndefined();
  });
});

describe("ObservabilityProvider contract", () => {
  it("passes unmodified shared contract suite with real composed adapters", async () => {
    const report = await assertProviderContractParity(
      observabilityProviderContract,
      [
        { name: "grafana-sentry-primary", create: startedProvider },
        { name: "grafana-sentry-parity", create: startedProvider },
      ],
    );

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(10);
  });
});
