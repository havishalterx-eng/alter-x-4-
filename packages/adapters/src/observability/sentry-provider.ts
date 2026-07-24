import * as Sentry from "@sentry/node";

import type { ErrorCapture, ProviderHealth } from "@alterx/shared-clients";

const DEFAULT_FLUSH_TIMEOUT_MS = 2_000;

export interface SentryErrorConfig {
  readonly dsn: string;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly environment: string;
  readonly flushTimeoutMs?: number;
}

export interface SentryCaptureContext {
  readonly level: "error";
  readonly tags: Readonly<Record<string, string>>;
  readonly extra: Readonly<Record<string, string | number | boolean>>;
  readonly contexts?: Readonly<{
    trace: Readonly<{
      trace_id: string;
      span_id?: string;
    }>;
  }>;
}

export interface SentryFacade {
  init(options: {
    readonly dsn: string;
    readonly environment: string;
    readonly release: string;
    readonly serverName: string;
    readonly sendDefaultPii: false;
    readonly skipOpenTelemetrySetup: true;
    readonly tracesSampleRate: 0;
  }): void;
  captureException(error: Error, context: SentryCaptureContext): string;
  flush(timeoutMs: number): Promise<boolean>;
  close(timeoutMs: number): Promise<boolean>;
}

export interface SentryProviderDependencies {
  readonly facade?: SentryFacade;
  readonly now?: () => Date;
  readonly monotonicNow?: () => bigint;
}

export class SentryConfigurationError extends Error {
  constructor(field: keyof SentryErrorConfig, reason = "must be non-empty") {
    super(`Sentry config field ${field} ${reason}`);
    this.name = "SentryConfigurationError";
  }
}

const DEFAULT_SENTRY_FACADE: SentryFacade = {
  init: (options) => {
    Sentry.init(options);
  },
  captureException: (error, context) =>
    Sentry.captureException(
      error,
      context as unknown as Parameters<typeof Sentry.captureException>[1],
    ),
  flush: (timeoutMs) => Sentry.flush(timeoutMs),
  close: (timeoutMs) => Sentry.close(timeoutMs),
};

function requireNonEmpty(field: keyof SentryErrorConfig, value: string): void {
  if (value.trim().length === 0) {
    throw new SentryConfigurationError(field);
  }
}

function elapsedMilliseconds(startedAt: bigint, endedAt: bigint): number {
  return Number(endedAt - startedAt) / 1_000_000;
}

export class SentryErrorProvider {
  readonly #config: SentryErrorConfig;
  readonly #facade: SentryFacade;
  readonly #now: () => Date;
  readonly #monotonicNow: () => bigint;
  #started = false;
  #captureFailures = 0;

  constructor(
    config: SentryErrorConfig,
    dependencies: SentryProviderDependencies = {},
  ) {
    requireNonEmpty("dsn", config.dsn);
    requireNonEmpty("serviceName", config.serviceName);
    requireNonEmpty("serviceVersion", config.serviceVersion);
    requireNonEmpty("environment", config.environment);
    if (
      config.flushTimeoutMs !== undefined &&
      (!Number.isInteger(config.flushTimeoutMs) || config.flushTimeoutMs < 1)
    ) {
      throw new SentryConfigurationError(
        "flushTimeoutMs",
        "must be a positive integer",
      );
    }

    this.#config = Object.freeze({ ...config });
    this.#facade = dependencies.facade ?? DEFAULT_SENTRY_FACADE;
    this.#now = dependencies.now ?? (() => new Date());
    this.#monotonicNow = dependencies.monotonicNow ?? process.hrtime.bigint;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    this.#facade.init({
      dsn: this.#config.dsn,
      environment: this.#config.environment,
      release: `${this.#config.serviceName}@${this.#config.serviceVersion}`,
      serverName: this.#config.serviceName,
      sendDefaultPii: false,
      skipOpenTelemetrySetup: true,
      tracesSampleRate: 0,
    });
    this.#started = true;
  }

  async captureError(input: ErrorCapture): Promise<void> {
    try {
      if (!this.#started) {
        throw new Error("Sentry provider has not started");
      }
      const exception = new Error(input.message);
      exception.name = input.name;
      this.#facade.captureException(exception, {
        level: "error",
        tags:
          input.traceId === undefined
            ? {}
            : { "otel.trace_id": input.traceId },
        ...(input.traceId === undefined
          ? {}
          : {
              contexts: {
                trace: {
                  trace_id: input.traceId,
                  ...(input.spanId === undefined
                    ? {}
                    : { span_id: input.spanId }),
                },
              },
            }),
        extra: {
          occurredAt: input.occurredAt,
          ...(input.attributes ?? {}),
        },
      });
    } catch {
      this.#captureFailures += 1;
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startedAt = this.#monotonicNow();
    return {
      status:
        this.#started && this.#captureFailures === 0 ? "healthy" : "degraded",
      checkedAt: this.#now().toISOString(),
      latencyMs: elapsedMilliseconds(startedAt, this.#monotonicNow()),
      details: {
        initialized: this.#started,
        captureFailures: this.#captureFailures,
      },
    };
  }

  async shutdown(): Promise<void> {
    if (!this.#started) {
      return;
    }
    const timeout = this.#config.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
    try {
      await this.#facade.flush(timeout);
      await this.#facade.close(timeout);
    } catch {
      this.#captureFailures += 1;
    } finally {
      this.#started = false;
    }
  }
}
