import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  ErrorCapture,
  LogEntry,
  MetricPoint,
  ObservabilityProvider,
  ProviderMetadata,
  TraceSpan,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_OBSERVABILITY_CAPABILITIES: ProviderCapabilities =
  mockCapabilities(1_048_576);

export interface ObservabilityEmissions {
  readonly traces: readonly TraceSpan[];
  readonly metrics: readonly MetricPoint[];
  readonly logs: readonly LogEntry[];
  readonly errors: readonly ErrorCapture[];
}

export interface MockObservabilityProvider extends ObservabilityProvider {
  getEmissions(): ObservabilityEmissions;
}

export interface MockObservabilityProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"ObservabilityProvider">;
  readonly capabilities?: ProviderCapabilities;
}

export function createMockObservabilityProvider(
  options: MockObservabilityProviderOptions = {},
): MockObservabilityProvider {
  const providerId = options.providerId ?? "mock.observability";
  const traces: TraceSpan[] = [];
  const metrics: MetricPoint[] = [];
  const logs: LogEntry[] = [];
  const errors: ErrorCapture[] = [];

  return createMockProvider<MockObservabilityProvider>({
    metadata:
      options.metadata ?? mockMetadata(providerId, "ObservabilityProvider"),
    capabilities: options.capabilities ?? MOCK_OBSERVABILITY_CAPABILITIES,
    implementation: {
      emitTrace: async (span) => {
        traces.push(Object.freeze({ ...span }));
      },
      emitMetric: async (metric) => {
        metrics.push(Object.freeze({ ...metric }));
      },
      emitLog: async (entry) => {
        logs.push(Object.freeze({ ...entry }));
      },
      captureError: async (error) => {
        errors.push(Object.freeze({ ...error }));
      },
      getEmissions: () =>
        Object.freeze({
          traces: Object.freeze([...traces]),
          metrics: Object.freeze([...metrics]),
          logs: Object.freeze([...logs]),
          errors: Object.freeze([...errors]),
        }),
    },
  });
}
