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
  const objects = new Map(
    initialReferences.map((reference) => [reference, Buffer.alloc(0)]),
  );
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
      putObject: async (reference, body) => {
        objects.set(reference, Buffer.from(body));
      },
      getObject: async (reference) => {
        const body = objects.get(reference);
        if (body === undefined) {
          throw new Error(`Object not found: ${reference}`);
        }
        return Buffer.from(body);
      },
      createPresignedDownloadUrl: async (reference, expiresInSeconds) =>
        `https://object-storage.invalid/download?reference=${encodeURIComponent(reference)}&expires=${expiresInSeconds}`,
      deletedReferences,
      put: (reference) => objects.set(reference, Buffer.alloc(0)),
    },
  });
}
