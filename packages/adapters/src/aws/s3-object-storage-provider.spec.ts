import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
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
    const objects = new Map([[reference, Buffer.alloc(0)]]);
    const real = new S3ObjectStorageProvider({
      region: "ap-south-1",
      client: {
        send: vi.fn(async (command) => {
          const input = command.input as { Bucket?: string; Key?: string };
          const current = `s3://${input.Bucket}/${input.Key}`;
          if (command instanceof PutObjectCommand) {
            objects.set(current, Buffer.from(command.input.Body as Buffer));
          }
          if (command instanceof GetObjectCommand) {
            const body = objects.get(current);
            if (body === undefined) throw { $metadata: { httpStatusCode: 404 } };
            return { Body: body };
          }
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

  it("maps opaque references to PutObject and GetObject byte round-trips", async () => {
    const body = Buffer.from([0, 1, 2, 255]);
    const send = vi.fn(async (command) => {
      if (command instanceof GetObjectCommand) return { Body: body };
      return {};
    });
    const provider = new S3ObjectStorageProvider({
      region: "ap-south-1",
      client: { send },
    });

    await provider.putObject("s3://tenant-bucket/path/audio.wav", body, "audio/wav");
    await expect(provider.getObject("s3://tenant-bucket/path/audio.wav")).resolves.toEqual(body);

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: "tenant-bucket",
      Key: "path/audio.wav",
      Body: body,
      ContentType: "audio/wav",
    });
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);
  });

  it("rejects non-S3 references", async () => {
    const provider = new S3ObjectStorageProvider({ region: "ap-south-1", client: { send: vi.fn() } });
    await expect(provider.deleteObject("https://example.test/object")).rejects.toThrow("s3://");
  });

  it("creates a bounded presigned download URL for an S3 reference", async () => {
    const presignGet = vi.fn().mockResolvedValue("https://signed.example.test/object");
    const provider = new S3ObjectStorageProvider({
      region: "ap-south-1",
      presignGet,
    });

    await expect(
      provider.createPresignedDownloadUrl("s3://tenant-bucket/path/raw.json", 900),
    ).resolves.toBe("https://signed.example.test/object");
    expect(presignGet).toHaveBeenCalledWith("tenant-bucket", "path/raw.json", 900);
    await expect(
      provider.createPresignedDownloadUrl("s3://tenant-bucket/path/raw.json", 0),
    ).rejects.toThrow("expiresInSeconds");
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
