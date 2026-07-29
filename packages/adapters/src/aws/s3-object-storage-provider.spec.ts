import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  createMockObjectStorageProvider,
  objectStorageProviderContract,
  runProviderContractTests,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";
import { S3ObjectStorageProvider } from "./s3-object-storage-provider";

describe("S3ObjectStorageProvider", () => {
  it("passes the shared contract in cross-adapter parity with the mock", async () => {
    const reference = "s3://contract-bucket/regulated/object";
    const objects = new Set([reference]);
    const real = new S3ObjectStorageProvider({
      region: "ap-south-1",
      client: {
        send: vi.fn(async (command) => {
          const input = command.input as { Bucket?: string; Key?: string };
          const current = `s3://${input.Bucket}/${input.Key}`;
          if (command instanceof DeleteObjectCommand) objects.delete(current);
          if (command instanceof HeadObjectCommand && !objects.has(current)) {
            throw { $metadata: { httpStatusCode: 404 } };
          }
          return {};
        }),
      },
    });
    const mock = createMockObjectStorageProvider([reference]);
    const report = await runProviderContractTests(objectStorageProviderContract, [
      { name: "aws-s3", create: () => real },
      { name: "mock", create: () => mock },
    ]);
    expect(report).toMatchObject({ passed: true });
  });

  it("maps s3 references to delete and head commands", async () => {
    const send = vi.fn().mockResolvedValue({});
    const provider = new S3ObjectStorageProvider({ region: "ap-south-1", client: { send } });
    await provider.deleteObject("s3://tenant-bucket/path/raw.json");
    expect(await provider.objectExists("s3://tenant-bucket/path/raw.json")).toBe(true);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[0]?.[0].input).toEqual({ Bucket: "tenant-bucket", Key: "path/raw.json" });
  });

  it("rejects non-S3 references", async () => {
    const provider = new S3ObjectStorageProvider({ region: "ap-south-1", client: { send: vi.fn() } });
    await expect(provider.deleteObject("https://example.test/object")).rejects.toThrow("s3://");
  });

  it("treats a 404 head response as verified absent and propagates other failures", async () => {
    const missing = new S3ObjectStorageProvider({
      region: "ap-south-1",
      client: { send: vi.fn().mockRejectedValue({ $metadata: { httpStatusCode: 404 } }) },
    });
    await expect(missing.objectExists("s3://tenant-bucket/missing")).resolves.toBe(false);

    const unavailable = new S3ObjectStorageProvider({
      region: "ap-south-1",
      client: { send: vi.fn().mockRejectedValue(new Error("network unavailable")) },
    });
    await expect(unavailable.objectExists("s3://tenant-bucket/object")).rejects.toThrow(
      "network unavailable",
    );
  });
});
