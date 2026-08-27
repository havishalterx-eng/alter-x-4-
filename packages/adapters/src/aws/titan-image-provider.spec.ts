import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  assertProviderContractParity,
  createMockImageGenProvider,
  createMockObjectStorageProvider,
  imageGenProviderContract,
  type ImageGenProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  TITAN_IMAGE_CAPABILITIES,
  TITAN_IMAGE_GENERATOR_V2_MODEL_ID,
  TitanImageProvider,
  type BedrockRuntimeCommandClient,
} from "./titan-image-provider";

const FIXED_CHECKED_AT = "2026-07-24T00:00:00.000Z";

// A real, valid 1x1 transparent PNG, base64-encoded -- real bytes a PNG
// decoder accepts, not placeholder garbage.
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function encodedResponse(images: readonly string[], error?: string): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ images, ...(error === undefined ? {} : { error }) }),
  );
}

function requestBody(command: InvokeModelCommand): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(command.input.body as Uint8Array).toString("utf8"),
  ) as Record<string, unknown>;
}

function fakeClient(
  handler: (command: InvokeModelCommand) => Promise<{ readonly body: Uint8Array }>,
): BedrockRuntimeCommandClient {
  return {
    send: vi.fn(async (command: InvokeModelCommand) => handler(command)),
  } as unknown as BedrockRuntimeCommandClient;
}

function successClient(): BedrockRuntimeCommandClient {
  return fakeClient(async () => ({
    body: encodedResponse([ONE_PIXEL_PNG_BASE64]),
  }));
}

function realProvider(): ImageGenProvider {
  return new TitanImageProvider(
    { region: "ap-south-1", bucketName: "alterx-media" },
    createMockObjectStorageProvider(),
    successClient(),
    () => new Date(FIXED_CHECKED_AT),
  );
}

function equivalentMockProvider(): ImageGenProvider {
  return createMockImageGenProvider({
    capabilities: TITAN_IMAGE_CAPABILITIES,
    health: {
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: {
        configured: true,
        modelId: TITAN_IMAGE_GENERATOR_V2_MODEL_ID,
        liveProbe: false,
      },
    },
    // The contract's own fixtures call generateImage with no width/height
    // override, so each provider returns its own default size. Titan's
    // real default is 1408x1408 (confirmed in AWS's own docs); match it
    // here so real-vs-mock parity compares like fixtures, not each
    // provider's unrelated idea of a "default" image.
    generateImage: async () => ({
      reference: "mock-image://titan-parity-fixture",
      mimeType: "image/png",
      width: 1408,
      height: 1408,
      servedBy: "mock.image-gen",
    }),
  });
}

describe("TitanImageProvider", () => {
  it("sends a Titan TEXT_IMAGE InvokeModel request with defaults", async () => {
    const send = vi.fn(async (command: InvokeModelCommand) => {
      expect(command.input.modelId).toBe(TITAN_IMAGE_GENERATOR_V2_MODEL_ID);
      expect(command.input.contentType).toBe("application/json");
      expect(command.input.accept).toBe("application/json");
      expect(requestBody(command)).toEqual({
        taskType: "TEXT_IMAGE",
        textToImageParams: { text: "a red bicycle" },
        imageGenerationConfig: {
          numberOfImages: 1,
          height: 1408,
          width: 1408,
        },
      });
      return { body: encodedResponse([ONE_PIXEL_PNG_BASE64]) };
    });
    const objectStorage = createMockObjectStorageProvider();
    const provider = new TitanImageProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objectStorage,
      { send } as unknown as BedrockRuntimeCommandClient,
    );

    const result = await provider.generateImage({
      tenantId: "tenant-1",
      prompt: "a red bicycle",
      options: {},
    });

    expect(result).toMatchObject({
      mimeType: "image/png",
      width: 1408,
      height: 1408,
      servedBy: "aws-bedrock-titan-image",
    });
    expect(result.reference).toMatch(
      /^s3:\/\/alterx-media\/tenants\/tenant-1\/media\/images\/img_[0-9a-f-]+\.png$/,
    );
    expect(
      Buffer.compare(
        await objectStorage.getObject(result.reference),
        Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
      ),
    ).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("supports explicit generation options and negativeText", async () => {
    const send = vi.fn(async (command: InvokeModelCommand) => {
      expect(requestBody(command)).toEqual({
        taskType: "TEXT_IMAGE",
        textToImageParams: { text: "a blue car", negativeText: "no rust" },
        imageGenerationConfig: {
          numberOfImages: 2,
          height: 512,
          width: 512,
          cfgScale: 8.5,
          seed: 42,
          quality: "premium",
        },
      });
      return { body: encodedResponse([ONE_PIXEL_PNG_BASE64]) };
    });
    const provider = new TitanImageProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      { send } as unknown as BedrockRuntimeCommandClient,
    );

    const result = await provider.generateImage({
      tenantId: "tenant-1",
      prompt: "a blue car",
      options: {
        negativeText: "no rust",
        numberOfImages: 2,
        height: 512,
        width: 512,
        cfgScale: 8.5,
        seed: 42,
        quality: "premium",
      },
    });

    expect(result).toMatchObject({ width: 512, height: 512 });
  });

  it("supports a standalone call with no runId or nodeExecutionId", async () => {
    const provider = new TitanImageProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      successClient(),
    );

    await expect(
      provider.generateImage({
        tenantId: "tenant-1",
        prompt: "a standalone test image",
        options: {},
      }),
    ).resolves.toMatchObject({ mimeType: "image/png" });
  });

  it("rejects invalid request shapes", async () => {
    const provider = new TitanImageProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      successClient(),
    );

    await expect(
      provider.generateImage({ tenantId: "", prompt: "x", options: {} }),
    ).rejects.toThrow(/tenantId/);
    await expect(
      provider.generateImage({ tenantId: "t", prompt: "", options: {} }),
    ).rejects.toThrow(/prompt is required/);
    await expect(
      provider.generateImage({
        tenantId: "t",
        prompt: "x".repeat(513),
        options: {},
      }),
    ).rejects.toThrow(/512 characters or fewer/);
    await expect(
      provider.generateImage({
        tenantId: "t",
        prompt: "x",
        options: { negativeText: "n".repeat(513) },
      }),
    ).rejects.toThrow(/negativeText must be 512/);
    await expect(
      provider.generateImage({
        tenantId: "t",
        prompt: "x",
        options: { width: 0 },
      }),
    ).rejects.toThrow(/positive integers/);
    await expect(
      provider.generateImage({
        tenantId: "t",
        prompt: "x",
        options: { width: 1409, height: 1409 },
      }),
    ).rejects.toThrow(/1408px on the longer side/);
    await expect(
      provider.generateImage({
        tenantId: "t",
        prompt: "x",
        options: { numberOfImages: 0 },
      }),
    ).rejects.toThrow(/numberOfImages must be a positive integer/);
  });

  it("surfaces a Titan content-moderation error instead of a bad image", async () => {
    const provider = new TitanImageProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      fakeClient(async () => ({
        body: encodedResponse([], "Content flagged by moderation policy"),
      })),
    );

    await expect(
      provider.generateImage({ tenantId: "t", prompt: "x", options: {} }),
    ).rejects.toThrow(/Content flagged by moderation policy/);
  });

  it("rejects a response with no images array", async () => {
    const provider = new TitanImageProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      fakeClient(async () => ({ body: new TextEncoder().encode("{}") })),
    );

    await expect(
      provider.generateImage({ tenantId: "t", prompt: "x", options: {} }),
    ).rejects.toThrow(/missing images array/);
  });

  it("validates required config at construction", () => {
    const objectStorage = createMockObjectStorageProvider();
    expect(
      () => new TitanImageProvider({ region: "", bucketName: "b" }, objectStorage),
    ).toThrow(/region/);
    expect(
      () =>
        new TitanImageProvider(
          { region: "ap-south-1", modelId: "", bucketName: "b" },
          objectStorage,
        ),
    ).toThrow(/model ID/);
    expect(
      () =>
        new TitanImageProvider(
          { region: "ap-south-1", bucketName: "" },
          objectStorage,
        ),
    ).toThrow(/bucket name/);
  });

  it("reports configured health without making a live Bedrock call", async () => {
    const send = vi.fn();
    const provider = new TitanImageProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      { send } as unknown as BedrockRuntimeCommandClient,
      () => new Date(FIXED_CHECKED_AT),
    );

    await expect(provider.healthCheck()).resolves.toEqual({
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: {
        configured: true,
        modelId: TITAN_IMAGE_GENERATOR_V2_MODEL_ID,
        liveProbe: false,
      },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("destroys the underlying client on close", () => {
    const destroy = vi.fn();
    const provider = new TitanImageProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      { send: vi.fn(), destroy } as unknown as BedrockRuntimeCommandClient,
    );

    provider.close();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("ImageGenProvider contract", () => {
  it("passes the unmodified shared contract suite with the real Titan adapter", async () => {
    const report = await assertProviderContractParity(imageGenProviderContract, [
      { name: "titan-primary", create: async () => realProvider() },
      { name: "titan-parity", create: async () => realProvider() },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });

  it("passes the unmodified shared contract suite across the real adapter and the mock", async () => {
    const report = await assertProviderContractParity(imageGenProviderContract, [
      { name: "titan-real", create: async () => realProvider() },
      { name: "titan-mock", create: async () => equivalentMockProvider() },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });
});
