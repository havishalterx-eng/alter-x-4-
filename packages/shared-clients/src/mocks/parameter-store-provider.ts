import type { ProviderCapabilities } from "@alterx/contracts";

import { createMockProvider } from "../mock-provider";
import type { ParameterStoreProvider, ProviderMetadata } from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export interface MockParameterStoreProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"ParameterStoreProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly parameters?: Readonly<Record<string, string>>;
}

export function createMockParameterStoreProvider(
  options: MockParameterStoreProviderOptions = {},
): ParameterStoreProvider {
  const providerId = options.providerId ?? "mock.parameter-store";
  const parameters = new Map(Object.entries(options.parameters ?? { "/contract/parameter": "contract-value" }));
  return createMockProvider<ParameterStoreProvider>({
    metadata: options.metadata ?? mockMetadata(providerId, "ParameterStoreProvider"),
    capabilities: options.capabilities ?? mockCapabilities(4_096),
    implementation: {
      getParameter: async (name) => {
        if (name.length === 0 || name.trim() !== name) {
          throw new Error("Parameter name must be non-empty and trimmed");
        }
        const value = parameters.get(name);
        if (value === undefined || value.length === 0) {
          throw new Error("Parameter was not found");
        }
        return value;
      },
    },
  });
}
