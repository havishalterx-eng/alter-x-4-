import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type { ObjectStorageProvider } from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export interface MockObjectStorageProvider extends ObjectStorageProvider {
  readonly deletedReferences: readonly string[];
  put(reference: string): void;
}

export function createMockObjectStorageProvider(
  initialReferences: readonly string[] = [],
): MockObjectStorageProvider {
  const objects = new Set(initialReferences);
  const deletedReferences: string[] = [];
  const capabilities: ProviderCapabilities = mockCapabilities(1);
  return createMockProvider<MockObjectStorageProvider>({
    metadata: mockMetadata("mock.object-storage", "ObjectStorageProvider"),
    capabilities,
    implementation: {
      deleteObject: async (reference) => {
        objects.delete(reference);
        deletedReferences.push(reference);
      },
      objectExists: async (reference) => objects.has(reference),
      createPresignedDownloadUrl: async (reference, expiresInSeconds) =>
        `https://object-storage.invalid/download?reference=${encodeURIComponent(reference)}&expires=${expiresInSeconds}`,
      deletedReferences,
      put: (reference) => objects.add(reference),
    },
  });
}
