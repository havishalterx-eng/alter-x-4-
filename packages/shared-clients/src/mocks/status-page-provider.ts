import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  ProviderMetadata,
  StatusPageIncident,
  StatusPageIncidentRequest,
  StatusPageProvider,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_STATUS_PAGE_CAPABILITIES: ProviderCapabilities =
  mockCapabilities(65_536);

export interface MockStatusPageProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"StatusPageProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly onPublish?: (request: StatusPageIncidentRequest) => void;
}

export type MockStatusPageProvider = StatusPageProvider;

export function createMockStatusPageProvider(
  options: MockStatusPageProviderOptions = {},
): MockStatusPageProvider {
  const providerId = options.providerId ?? "mock.status-page";
  return createMockProvider<StatusPageProvider>({
    metadata:
      options.metadata ?? mockMetadata(providerId, "StatusPageProvider"),
    capabilities: options.capabilities ?? MOCK_STATUS_PAGE_CAPABILITIES,
    implementation: {
      publishIncident: async (request): Promise<StatusPageIncident> => {
        options.onPublish?.(request);
        return {
          providerIncidentRef: "inc_contract",
          status: request.status,
          publishedAt: "2026-08-06T00:00:00.000Z",
        };
      },
    },
  });
}
