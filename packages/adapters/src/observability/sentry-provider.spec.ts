import { describe, expect, it, vi } from "vitest";

const sentrySdk = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(() => "event-id"),
  flush: vi.fn().mockResolvedValue(true),
  close: vi.fn().mockResolvedValue(true),
}));

vi.mock("@sentry/node", () => sentrySdk);

import {
  SentryConfigurationError,
  SentryErrorProvider,
  type SentryErrorConfig,
  type SentryFacade,
} from "./sentry-provider";

const CONFIG: SentryErrorConfig = {
  dsn: "https://[resolved-at-runtime]@sentry.example.invalid/1",
  serviceName: "audit-service",
  serviceVersion: "1.0.0",
  environment: "test",
};

const TRACE_ID = "0123456789abcdef0123456789abcdef";
const SPAN_ID = "0123456789abcdef";

function facade(overrides: Partial<SentryFacade> = {}): SentryFacade {
  return {
    init: vi.fn(),
    captureException: vi.fn(() => "event-id"),
    flush: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("SentryErrorProvider", () => {
  it("initializes error-only Sentry and maps ErrorCapture fields", async () => {
    const sdk = facade();
    const provider = new SentryErrorProvider(CONFIG, {
      facade: sdk,
      now: () => new Date("2026-07-24T00:00:00.000Z"),
      monotonicNow: () => 0n,
    });
    await provider.start();
    await provider.start();

    await provider.captureError({
      name: "AuditWriteError",
      message: "append failed",
      occurredAt: "2026-07-24T00:00:00.000Z",
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      attributes: { retryable: true, attempt: 2 },
    });

    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.init).toHaveBeenCalledWith({
      dsn: CONFIG.dsn,
      environment: "test",
      release: "audit-service@1.0.0",
      serverName: "audit-service",
      sendDefaultPii: false,
      skipOpenTelemetrySetup: true,
      tracesSampleRate: 0,
    });
    const [exception, context] = vi.mocked(sdk.captureException).mock.calls[0] ?? [];
    expect(exception).toMatchObject({
      name: "AuditWriteError",
      message: "append failed",
    });
    expect(context).toEqual({
      level: "error",
      tags: { "otel.trace_id": TRACE_ID },
      contexts: {
        trace: {
          trace_id: TRACE_ID,
          span_id: SPAN_ID,
        },
      },
      extra: {
        occurredAt: "2026-07-24T00:00:00.000Z",
        retryable: true,
        attempt: 2,
      },
    });
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "healthy",
      details: { initialized: true, captureFailures: 0 },
    });
  });

  it("omits optional trace tags and attributes", async () => {
    const sdk = facade();
    const provider = new SentryErrorProvider(CONFIG, { facade: sdk });
    await provider.start();
    await provider.captureError({
      name: "ContractError",
      message: "contract error",
      occurredAt: "2026-07-24T00:00:00.000Z",
    });

    expect(sdk.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      {
        level: "error",
        tags: {},
        extra: { occurredAt: "2026-07-24T00:00:00.000Z" },
      },
    );
  });

  it("attaches real trace context when only traceId is provided", async () => {
    const sdk = facade();
    const provider = new SentryErrorProvider(CONFIG, { facade: sdk });
    await provider.start();

    await provider.captureError({
      name: "TraceOnlyError",
      message: "span unavailable",
      occurredAt: "2026-07-24T00:00:00.000Z",
      traceId: TRACE_ID,
    });

    expect(sdk.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        contexts: { trace: { trace_id: TRACE_ID } },
      }),
    );
  });

  it("does not throw on capture failure and reports degraded health", async () => {
    const sdk = facade({
      captureException: vi.fn(() => {
        throw new Error("Sentry transport unavailable");
      }),
    });
    const provider = new SentryErrorProvider(CONFIG, { facade: sdk });

    await expect(
      provider.captureError({
        name: "BeforeStart",
        message: "not initialized",
        occurredAt: "2026-07-24T00:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
    await provider.start();
    await expect(
      provider.captureError({
        name: "TransportError",
        message: "capture failed",
        occurredAt: "2026-07-24T00:00:01.000Z",
      }),
    ).resolves.toBeUndefined();
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "degraded",
      details: { captureFailures: 2 },
    });
  });

  it("flushes and closes once; shutdown failures stay non-fatal", async () => {
    const sdk = facade({
      flush: vi.fn().mockRejectedValue(new Error("flush unavailable")),
    });
    const provider = new SentryErrorProvider(
      { ...CONFIG, flushTimeoutMs: 17 },
      { facade: sdk },
    );
    await provider.shutdown();
    await provider.start();
    await provider.shutdown();
    await provider.shutdown();

    expect(sdk.flush).toHaveBeenCalledWith(17);
    expect(sdk.close).not.toHaveBeenCalled();
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "degraded",
      details: { initialized: false, captureFailures: 1 },
    });
  });

  it("uses @sentry/node facade by default", async () => {
    const provider = new SentryErrorProvider(CONFIG);
    await provider.start();
    await provider.captureError({
      name: "DefaultFacadeError",
      message: "mapped",
      occurredAt: "2026-07-24T00:00:00.000Z",
    });
    await provider.shutdown();

    expect(sentrySdk.init).toHaveBeenCalled();
    expect(sentrySdk.captureException).toHaveBeenCalled();
    expect(sentrySdk.flush).toHaveBeenCalled();
    expect(sentrySdk.close).toHaveBeenCalled();
  });

  it.each([
    ["dsn", { dsn: "" }],
    ["serviceName", { serviceName: "" }],
    ["serviceVersion", { serviceVersion: " " }],
    ["environment", { environment: "" }],
    ["flushTimeoutMs", { flushTimeoutMs: 0 }],
  ])("rejects invalid %s", (field, override) => {
    expect(() => new SentryErrorProvider({ ...CONFIG, ...override })).toThrow(
      SentryConfigurationError,
    );
    expect(() => new SentryErrorProvider({ ...CONFIG, ...override })).toThrow(
      field,
    );
  });
});
