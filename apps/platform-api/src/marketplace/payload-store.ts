/**
 * Narrow port for copying listing payloads into installer-owned storage.
 *
 * The canonical `ObjectStorageProvider` interface only declares `deleteObject`
 * and `objectExists`, so it cannot express the copy this module performs.
 * Widening that interface is a cross-package change owned elsewhere; this port
 * keeps the dependency inside the marketplace module instead.
 * `S3ObjectStorageProvider` satisfies it structurally.
 */
export interface MarketplacePayloadStore {
  getObject(reference: string): Promise<Buffer>;
  putObject(
    reference: string,
    body: Buffer,
    contentType: string,
  ): Promise<void>;
}

export interface InMemoryPayloadStore extends MarketplacePayloadStore {
  readonly references: readonly string[];
  seed(reference: string, body: Buffer): void;
}

/** Mock-mode implementation. Keeps installs runnable without cloud credentials. */
export function createInMemoryPayloadStore(
  initial: ReadonlyMap<string, Buffer> = new Map(),
): InMemoryPayloadStore {
  const objects = new Map<string, Buffer>(initial);

  return {
    get references(): readonly string[] {
      return [...objects.keys()];
    },
    seed(reference: string, body: Buffer): void {
      objects.set(reference, body);
    },
    async getObject(reference: string): Promise<Buffer> {
      const body = objects.get(reference);
      if (!body) {
        throw new Error(`Payload reference not found: ${reference}`);
      }
      return body;
    },
    async putObject(reference: string, body: Buffer): Promise<void> {
      objects.set(reference, body);
    },
  };
}
