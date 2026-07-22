import {
  ProviderCapabilitiesSchema,
  type ProviderCapabilities,
} from "@alterx/contracts";
import type {
  BaseProvider,
  ProviderHealth,
} from "./provider-types";

type MockImplementation<TProvider extends BaseProvider> = Omit<
  TProvider,
  keyof BaseProvider
>;

export interface MockProviderOptions<TProvider extends BaseProvider> {
  readonly metadata: TProvider["metadata"];
  readonly capabilities: ProviderCapabilities;
  readonly implementation: MockImplementation<TProvider>;
  readonly health?: ProviderHealth;
}

const DEFAULT_MOCK_HEALTH: ProviderHealth = Object.freeze({
  status: "healthy",
  checkedAt: "1970-01-01T00:00:00.000Z",
  latencyMs: 0,
});

export function createMockProvider<TProvider extends BaseProvider>(
  options: MockProviderOptions<TProvider>,
): TProvider {
  const capabilities = ProviderCapabilitiesSchema.parse(options.capabilities);
  const health = options.health ?? DEFAULT_MOCK_HEALTH;

  return Object.freeze({
    ...options.implementation,
    metadata: Object.freeze({
      ...options.metadata,
      migration: Object.freeze({ ...options.metadata.migration }),
    }),
    capabilities: Object.freeze(capabilities),
    healthCheck: async () => health,
  }) as TProvider;
}
