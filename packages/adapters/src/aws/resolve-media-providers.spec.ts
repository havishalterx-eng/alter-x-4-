import { afterEach, describe, expect, it } from "vitest";
import { createMockObjectStorageProvider } from "@alterx/shared-clients";
import {
  resolveImageGenProvider,
  resolveMediaObjectStorageProvider,
  resolveSpeechToTextProvider,
  resolveTextToSpeechProvider,
} from "./resolve-media-providers";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("resolveMediaObjectStorageProvider", () => {
  it("defaults to the mock provider outside production", () => {
    delete process.env.MEDIA_OBJECT_STORAGE_PROVIDER;
    delete process.env.NODE_ENV;
    expect(resolveMediaObjectStorageProvider().metadata.providerId).toBe(
      "mock.object-storage",
    );
  });

  it("refuses to serve a mock object store when NODE_ENV=production", () => {
    delete process.env.MEDIA_OBJECT_STORAGE_PROVIDER;
    process.env.NODE_ENV = "production";
    expect(() => resolveMediaObjectStorageProvider()).toThrow(
      "MEDIA_OBJECT_STORAGE_PROVIDER=mock is not allowed when NODE_ENV=production",
    );
  });

  it("builds the real S3 provider when explicitly selected", () => {
    process.env.MEDIA_OBJECT_STORAGE_PROVIDER = "s3";
    process.env.AWS_REGION = "ap-south-1";
    expect(resolveMediaObjectStorageProvider().metadata.providerId).toBe("aws.s3");
  });
});

describe("resolveImageGenProvider", () => {
  it("defaults to the mock provider outside production", () => {
    delete process.env.IMAGE_GEN_PROVIDER;
    delete process.env.NODE_ENV;
    const provider = resolveImageGenProvider(createMockObjectStorageProvider());
    expect(provider.metadata.providerId).toBe("mock.image-gen");
  });

  it("refuses to serve a mock image provider when NODE_ENV=production", () => {
    delete process.env.IMAGE_GEN_PROVIDER;
    process.env.NODE_ENV = "production";
    expect(() =>
      resolveImageGenProvider(createMockObjectStorageProvider()),
    ).toThrow("IMAGE_GEN_PROVIDER=mock is not allowed when NODE_ENV=production");
  });

  it("fails closed instead of silently falling back to mock when IMAGE_GEN_PROVIDER=titan is missing a bucket", () => {
    process.env.IMAGE_GEN_PROVIDER = "titan";
    delete process.env.MEDIA_BUCKET_NAME;
    expect(() =>
      resolveImageGenProvider(createMockObjectStorageProvider()),
    ).toThrow("MEDIA_BUCKET_NAME is required when IMAGE_GEN_PROVIDER=titan");
  });

  it("builds the real Titan provider when explicitly selected with a bucket", () => {
    process.env.IMAGE_GEN_PROVIDER = "titan";
    process.env.MEDIA_BUCKET_NAME = "alterx-media";
    const provider = resolveImageGenProvider(createMockObjectStorageProvider());
    expect(provider.metadata.providerId).toBe("aws-bedrock-titan-image");
  });
});

describe("resolveTextToSpeechProvider", () => {
  it("defaults to the mock provider outside production", () => {
    delete process.env.TEXT_TO_SPEECH_PROVIDER;
    delete process.env.NODE_ENV;
    const provider = resolveTextToSpeechProvider(createMockObjectStorageProvider());
    expect(provider.metadata.providerId).toBe("mock.text-to-speech");
  });

  it("refuses to serve a mock speech provider when NODE_ENV=production", () => {
    delete process.env.TEXT_TO_SPEECH_PROVIDER;
    process.env.NODE_ENV = "production";
    expect(() =>
      resolveTextToSpeechProvider(createMockObjectStorageProvider()),
    ).toThrow("TEXT_TO_SPEECH_PROVIDER=mock is not allowed when NODE_ENV=production");
  });

  it("fails closed instead of silently falling back to mock when TEXT_TO_SPEECH_PROVIDER=polly is missing a bucket", () => {
    process.env.TEXT_TO_SPEECH_PROVIDER = "polly";
    delete process.env.MEDIA_BUCKET_NAME;
    expect(() =>
      resolveTextToSpeechProvider(createMockObjectStorageProvider()),
    ).toThrow("MEDIA_BUCKET_NAME is required when TEXT_TO_SPEECH_PROVIDER=polly");
  });

  it("builds the real Polly provider when explicitly selected with a bucket", () => {
    process.env.TEXT_TO_SPEECH_PROVIDER = "polly";
    process.env.MEDIA_BUCKET_NAME = "alterx-media";
    const provider = resolveTextToSpeechProvider(createMockObjectStorageProvider());
    expect(provider.metadata.providerId).toBe("aws-polly");
  });
});

describe("resolveSpeechToTextProvider", () => {
  it("defaults to the mock provider outside production", () => {
    delete process.env.SPEECH_TO_TEXT_PROVIDER;
    delete process.env.NODE_ENV;
    const provider = resolveSpeechToTextProvider(createMockObjectStorageProvider());
    expect(provider.metadata.providerId).toBe("mock.speech-to-text");
  });

  it("refuses to serve a mock transcription provider when NODE_ENV=production", () => {
    delete process.env.SPEECH_TO_TEXT_PROVIDER;
    process.env.NODE_ENV = "production";
    expect(() =>
      resolveSpeechToTextProvider(createMockObjectStorageProvider()),
    ).toThrow("SPEECH_TO_TEXT_PROVIDER=mock is not allowed when NODE_ENV=production");
  });

  it("fails closed instead of silently falling back to mock when SPEECH_TO_TEXT_PROVIDER=transcribe is missing a bucket", () => {
    process.env.SPEECH_TO_TEXT_PROVIDER = "transcribe";
    delete process.env.MEDIA_BUCKET_NAME;
    expect(() =>
      resolveSpeechToTextProvider(createMockObjectStorageProvider()),
    ).toThrow("MEDIA_BUCKET_NAME is required when SPEECH_TO_TEXT_PROVIDER=transcribe");
  });

  it("builds the real Transcribe provider when explicitly selected with a bucket", () => {
    process.env.SPEECH_TO_TEXT_PROVIDER = "transcribe";
    process.env.MEDIA_BUCKET_NAME = "alterx-media";
    const provider = resolveSpeechToTextProvider(createMockObjectStorageProvider());
    expect(provider.metadata.providerId).toBe("aws-transcribe");
  });
});
