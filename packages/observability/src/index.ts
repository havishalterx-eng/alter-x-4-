import type { ManagedObservabilityProvider } from "@alterx/adapters/observability";
import type {
  ObservabilityProvider,
  ProviderHealth,
} from "@alterx/shared-clients";

export type InitializableObservabilityProvider = ObservabilityProvider &
  Pick<ManagedObservabilityProvider, "start" | "shutdown">;

export interface InitObservabilityOptions {
  readonly checkHealthOnStart?: boolean;
}

export interface ObservabilityHandle {
  readonly provider: ObservabilityProvider;
  readonly initialHealth: ProviderHealth | undefined;
  shutdown(): Promise<void>;
}

/**
 * Starts process-global OTel/Sentry registration through the concrete adapter.
 * Call once before loading app modules; call shutdown from the process lifecycle
 * hook so batched telemetry drains before exit.
 */
export async function initObservability(
  provider: InitializableObservabilityProvider,
  options: InitObservabilityOptions = {},
): Promise<ObservabilityHandle> {
  await provider.start();
  const initialHealth =
    options.checkHealthOnStart === false
      ? undefined
      : await provider.healthCheck();
  let shutdownPromise: Promise<void> | undefined;

  return Object.freeze({
    provider,
    initialHealth,
    shutdown: () => {
      shutdownPromise ??= provider.shutdown();
      return shutdownPromise;
    },
  });
}
