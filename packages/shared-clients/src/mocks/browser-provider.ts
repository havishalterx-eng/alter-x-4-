import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type { BrowserInspectionResult, BrowserProvider } from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_BROWSER_CAPABILITIES: ProviderCapabilities = mockCapabilities(1_048_576);

export function createMockBrowserProvider(
  inspection: BrowserInspectionResult,
): BrowserProvider {
  return createMockProvider<BrowserProvider>({
    metadata: mockMetadata("mock.browser", "BrowserProvider"),
    capabilities: MOCK_BROWSER_CAPABILITIES,
    implementation: { inspectPage: async () => inspection },
  });
}
