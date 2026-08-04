import { describe, expect, it } from "vitest";

import { createMockObjectStorageProvider } from "./object-storage-provider";

describe("createMockObjectStorageProvider", () => {
  it("records deterministic deletion and existence behavior", async () => {
    const reference = "s3://fixture-bucket/path/object";
    const provider = createMockObjectStorageProvider([reference]);
    await expect(provider.objectExists(reference)).resolves.toBe(true);
    await provider.deleteObject(reference);
    await expect(provider.objectExists(reference)).resolves.toBe(false);
    expect(provider.deletedReferences).toEqual([reference]);
    expect(provider.metadata.interfaceName).toBe("ObjectStorageProvider");
    await expect(provider.healthCheck()).resolves.toMatchObject({ status: "healthy" });
  });

  it("round-trips opaque binary objects without exposing storage internals", async () => {
    const reference = "s3://fixture-bucket/path/audio.wav";
    const body = Buffer.from([0, 1, 2, 255]);
    const provider = createMockObjectStorageProvider();

    await provider.putObject(reference, body, "audio/wav");
    await expect(provider.getObject(reference)).resolves.toEqual(body);
  });
});
