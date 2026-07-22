import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  CanonicalProviderInterfaceName,
  ProviderMetadata,
} from "../provider-types";

export const MOCK_CHECKED_AT = "1970-01-01T00:00:00.000Z";

export function mockCapabilities(
  maximumPayload: number,
): ProviderCapabilities {
  return {
    streaming: false,
    tool_calling: false,
    vision: false,
    structured_output: true,
    long_context: false,
    regional_availability: ["local"],
    data_residency: ["local"],
    batch_support: false,
    maximum_payload: maximumPayload,
    supported_languages: ["en"],
    cost_model: { rates: [] },
  };
}

export function mockMetadata<
  TInterface extends CanonicalProviderInterfaceName,
>(
  providerId: string,
  interfaceName: TInterface,
): ProviderMetadata<TInterface> {
  return {
    providerId,
    interfaceName,
    displayName: `${interfaceName} deterministic mock`,
    version: "1.0.0",
    telemetryNamespace: `alter.mock.${providerId}`,
    supportsTenantOverrides: true,
    migration: {
      strategyVersion: "1",
      rollbackSupported: true,
    },
  };
}
