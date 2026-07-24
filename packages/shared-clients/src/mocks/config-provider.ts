import type { ModelAliasPolicy, ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import {
  ModelAliasResolutionError,
  type ConfigProvider,
  type ProviderHealth,
  type ProviderMetadata,
  type ToolPermissionBinding,
  type ToolPermissionRequest,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_CONFIG_CAPABILITIES: ProviderCapabilities =
  mockCapabilities(65_536);

export const DEFAULT_MODEL_ALIAS_POLICY: ModelAliasPolicy = Object.freeze({
  version: "mock.1",
  bindings: {
    FAST: {
      model_id: "mock.fast.v1",
      capability_tags: ["low-latency"],
    },
    STANDARD: {
      model_id: "mock.standard.v1",
      capability_tags: ["general"],
    },
    ADVANCED: {
      model_id: "mock.advanced.v1",
      capability_tags: ["reasoning"],
    },
    CEILING: {
      model_id: "mock.ceiling.v1",
      capability_tags: ["frontier"],
    },
  },
});

export interface MockConfigProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"ConfigProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly policy?: ModelAliasPolicy;
  readonly toolPermission?: ToolPermissionBinding;
  readonly resolveToolPermission?: (
    request: ToolPermissionRequest,
  ) => Promise<ToolPermissionBinding>;
  readonly health?: ProviderHealth;
}

export const DEFAULT_TOOL_PERMISSION: ToolPermissionBinding = Object.freeze({
  allowed: true,
  rateLimitPerMinute: 60,
  requiredScopes: [],
});

export function createMockConfigProvider(
  options: MockConfigProviderOptions = {},
): ConfigProvider {
  const providerId = options.providerId ?? "mock.config";
  const policy = options.policy ?? DEFAULT_MODEL_ALIAS_POLICY;

  return createMockProvider<ConfigProvider>({
    metadata: options.metadata ?? mockMetadata(providerId, "ConfigProvider"),
    capabilities: options.capabilities ?? MOCK_CONFIG_CAPABILITIES,
    ...(options.health === undefined ? {} : { health: options.health }),
    implementation: {
      resolveModelAlias: async (alias) => {
        const binding = policy.bindings[alias];
        if (binding === undefined) {
          throw new ModelAliasResolutionError(alias);
        }
        return binding;
      },
      resolveToolPermission:
        options.resolveToolPermission ??
        (async () => options.toolPermission ?? DEFAULT_TOOL_PERMISSION),
    },
  });
}
