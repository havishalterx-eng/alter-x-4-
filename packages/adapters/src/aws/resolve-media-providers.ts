import {
  createMockImageGenProvider,
  createMockObjectStorageProvider,
  createMockSpeechToTextProvider,
  createMockTextToSpeechProvider,
  type ImageGenProvider,
  type ObjectStorageProvider,
  type SpeechToTextProvider,
  type TextToSpeechProvider,
} from "@alterx/shared-clients";
import { S3ObjectStorageProvider } from "./s3-object-storage-provider";
import { TitanImageProvider } from "./titan-image-provider";
import { PollyTtsProvider } from "./polly-tts-provider";
import { TranscribeSttProvider } from "./transcribe-stt-provider";

// Mirrors resolveEmailProvider()'s (../ses/resolve-email-provider.ts)
// exact shape for all 4 media-related dependencies: an env-var switch
// that falls back to each interface's stage-1 mock when the real AWS
// provider isn't configured, fatal (never a silent mock) when
// NODE_ENV=production. Same discipline, same reasoning -- see that
// file's own comment for why this is a relocatable, portable pattern
// rather than being duplicated ad hoc per service.

function awsRegion(): string {
  return process.env.AWS_REGION ?? "ap-south-1";
}

function requireMediaBucketName(providerEnvVar: string): string {
  const bucketName = process.env.MEDIA_BUCKET_NAME;
  if (!bucketName) {
    throw new Error(`MEDIA_BUCKET_NAME is required when ${providerEnvVar}`);
  }
  return bucketName;
}

function forbidMockInProduction(envVarDescription: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${envVarDescription}=mock is not allowed when NODE_ENV=production`);
  }
}

export function resolveMediaObjectStorageProvider(): ObjectStorageProvider {
  const provider = process.env.MEDIA_OBJECT_STORAGE_PROVIDER ?? "mock";
  if (provider === "s3") {
    return new S3ObjectStorageProvider({ region: awsRegion() });
  }
  forbidMockInProduction("MEDIA_OBJECT_STORAGE_PROVIDER");
  return createMockObjectStorageProvider();
}

export function resolveImageGenProvider(
  objectStorage: ObjectStorageProvider,
): ImageGenProvider {
  const provider = process.env.IMAGE_GEN_PROVIDER ?? "mock";
  if (provider === "titan") {
    const bucketName = requireMediaBucketName("IMAGE_GEN_PROVIDER=titan");
    return new TitanImageProvider(
      { region: awsRegion(), bucketName },
      objectStorage,
    );
  }
  forbidMockInProduction("IMAGE_GEN_PROVIDER");
  return createMockImageGenProvider();
}

export function resolveTextToSpeechProvider(
  objectStorage: ObjectStorageProvider,
): TextToSpeechProvider {
  const provider = process.env.TEXT_TO_SPEECH_PROVIDER ?? "mock";
  if (provider === "polly") {
    const bucketName = requireMediaBucketName("TEXT_TO_SPEECH_PROVIDER=polly");
    return new PollyTtsProvider(
      { region: awsRegion(), bucketName },
      objectStorage,
    );
  }
  forbidMockInProduction("TEXT_TO_SPEECH_PROVIDER");
  return createMockTextToSpeechProvider();
}

export function resolveSpeechToTextProvider(
  objectStorage: ObjectStorageProvider,
): SpeechToTextProvider {
  const provider = process.env.SPEECH_TO_TEXT_PROVIDER ?? "mock";
  if (provider === "transcribe") {
    const bucketName = requireMediaBucketName("SPEECH_TO_TEXT_PROVIDER=transcribe");
    return new TranscribeSttProvider(
      { region: awsRegion(), bucketName },
      objectStorage,
    );
  }
  forbidMockInProduction("SPEECH_TO_TEXT_PROVIDER");
  return createMockSpeechToTextProvider();
}
