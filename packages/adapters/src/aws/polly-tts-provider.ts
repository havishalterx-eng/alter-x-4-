import { randomUUID } from "node:crypto";

import {
  Engine as PollyEngineEnum,
  PollyClient,
  SynthesizeSpeechCommand,
  TextType as PollyTextTypeEnum,
  VoiceId as PollyVoiceIdEnum,
  type Engine as PollyEngine,
  type SynthesizeSpeechCommandOutput,
  type TextType as PollyTextType,
  type VoiceId as PollyVoiceId,
} from "@aws-sdk/client-polly";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  JsonValue,
  ObjectStorageProvider,
  ProviderHealth,
  ProviderMetadata,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
  TextToSpeechProvider,
} from "@alterx/shared-clients";

// Polly's SynthesizeSpeech request/response shape, verified against AWS's
// own current documentation (not guessed):
// https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html
//
// Confirmed there:
// - request: {Text, OutputFormat (required), VoiceId (required), Engine?,
//   TextType?, SampleRate?, ...}; OutputFormat is one of
//   json|mp3|ogg_opus|ogg_vorbis|pcm|mulaw|alaw; Engine is one of
//   standard|neural|long-form|generative (default standard); TextType is
//   text|ssml (default text); Text is capped at 6000 characters total for
//   this API.
// - response: {AudioStream, ContentType, RequestCharacters}; AudioStream
//   is a stream (StreamingBlobTypes in the v3 SDK), not a Buffer.
// - requesting OutputFormat "pcm" always returns signed 16-bit, 1-channel
//   (mono), little-endian samples; SampleRate for pcm is "8000" or
//   "16000", defaulting to "16000".
// Derived from the SDK's own enum objects rather than hand-typed, so this
// list can never drift from what @aws-sdk/client-polly actually accepts.
export const POLLY_VOICE_IDS: readonly PollyVoiceId[] = Object.values(PollyVoiceIdEnum);
const POLLY_VOICE_ID_SET: ReadonlySet<string> = new Set(POLLY_VOICE_IDS);

const POLLY_ENGINES: readonly PollyEngine[] = Object.values(PollyEngineEnum);
const POLLY_ENGINE_SET: ReadonlySet<string> = new Set(POLLY_ENGINES);

const POLLY_TEXT_TYPES: readonly PollyTextType[] = Object.values(PollyTextTypeEnum);
const POLLY_TEXT_TYPE_SET: ReadonlySet<string> = new Set(POLLY_TEXT_TYPES);

const MAX_TEXT_LENGTH = 6_000;

// Duration-computation design decision (see PR description for full
// reasoning): request PCM output rather than a second speech-marks call.
// PCM's byte layout is fully specified by Polly's documentation (16-bit
// signed, mono, little-endian, at this fixed sample rate), so durationMs
// is exact arithmetic on the byte length -- no approximation, no second
// billable Polly call, no audio-parsing dependency. Fixed rather than
// caller-configurable so the duration math always matches what was
// actually requested.
const PCM_SAMPLE_RATE_HZ = 16_000;
const PCM_BYTES_PER_SAMPLE = 2; // 16-bit signed
const PCM_CHANNELS = 1; // mono

export interface PollyTtsProviderConfig {
  readonly region: string;
  readonly bucketName: string;
}

export interface PollyCommandClient {
  send(command: SynthesizeSpeechCommand): Promise<SynthesizeSpeechCommandOutput>;
  destroy?(): void;
}

export const POLLY_TTS_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: false,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 10_485_760,
  supported_languages: ["en"],
  cost_model: { rates: [] },
};

const POLLY_TTS_METADATA: ProviderMetadata<"TextToSpeechProvider"> = {
  providerId: "aws-polly",
  interfaceName: "TextToSpeechProvider",
  displayName: "AWS Polly",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.aws.polly",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "aws-polly-v1",
    rollbackSupported: true,
  },
};

export class PollyTtsProvider implements TextToSpeechProvider {
  readonly metadata = POLLY_TTS_METADATA;
  readonly capabilities = POLLY_TTS_CAPABILITIES;

  readonly #client: PollyCommandClient;
  readonly #bucketName: string;
  readonly #objectStorage: ObjectStorageProvider;
  readonly #now: () => Date;

  constructor(
    config: PollyTtsProviderConfig,
    objectStorage: ObjectStorageProvider,
    client?: PollyCommandClient,
    now?: () => Date,
  ) {
    if (config.region.trim().length === 0) {
      throw new Error("Polly region is required");
    }
    if (config.bucketName.trim().length === 0) {
      throw new Error("Polly audio bucket name is required");
    }
    this.#bucketName = config.bucketName;
    this.#objectStorage = objectStorage;
    this.#client = client ?? new PollyClient({ region: config.region });
    this.#now = now ?? (() => new Date());
  }

  async synthesizeSpeech(
    request: SpeechSynthesisRequest,
  ): Promise<SpeechSynthesisResult> {
    const { voiceId, engine, textType } = parseVoiceConfig(request);
    validateSpeechRequest(request);

    const response = await this.#client.send(
      new SynthesizeSpeechCommand({
        Text: request.text,
        OutputFormat: "pcm",
        SampleRate: String(PCM_SAMPLE_RATE_HZ),
        VoiceId: voiceId,
        ...(engine === undefined ? {} : { Engine: engine }),
        ...(textType === undefined ? {} : { TextType: textType }),
      }),
    );
    const pcmBytes = await readAudioStream(response.AudioStream);
    const durationMs = pcmDurationMs(pcmBytes.byteLength);
    const wavBytes = wrapPcmAsWav(pcmBytes);

    const reference = `s3://${this.#bucketName}/tenants/${request.tenantId}/media/audio/${newSpeechAudioId()}.wav`;
    await this.#objectStorage.putObject(reference, wavBytes, "audio/wav");

    return { reference, mimeType: "audio/wav", durationMs };
  }

  async healthCheck(): Promise<ProviderHealth> {
    // Polly synthesis costs real money per call, same reasoning as
    // AwsBedrockModelProvider/TitanImageProvider: report healthy once
    // constructed, don't spend money on a live probe.
    return {
      status: "healthy",
      checkedAt: this.#now().toISOString(),
      latencyMs: 0,
      details: { configured: true, liveProbe: false },
    };
  }

  close(): void {
    this.#client.destroy?.();
  }
}

function jsonString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseVoiceConfig(request: SpeechSynthesisRequest): {
  readonly voiceId: PollyVoiceId;
  readonly engine: PollyEngine | undefined;
  readonly textType: PollyTextType | undefined;
} {
  const voiceIdValue = jsonString(request.voiceConfig.voiceId);
  if (voiceIdValue === undefined || voiceIdValue.trim().length === 0) {
    throw new Error("Speech synthesis voiceConfig.voiceId is required");
  }
  if (!isPollyVoiceId(voiceIdValue)) {
    throw new Error(`Speech synthesis voiceConfig.voiceId "${voiceIdValue}" is not a known Polly voice`);
  }
  const voiceId = voiceIdValue;

  const engineValue = jsonString(request.voiceConfig.engine);
  if (engineValue !== undefined && !isPollyEngine(engineValue)) {
    throw new Error(
      `Speech synthesis voiceConfig.engine must be one of ${POLLY_ENGINES.join(", ")}`,
    );
  }

  const textTypeValue = jsonString(request.voiceConfig.textType);
  if (textTypeValue !== undefined && !isPollyTextType(textTypeValue)) {
    throw new Error(
      `Speech synthesis voiceConfig.textType must be one of ${POLLY_TEXT_TYPES.join(", ")}`,
    );
  }

  return {
    voiceId,
    engine: engineValue,
    textType: textTypeValue,
  };
}

function isPollyVoiceId(value: string): value is PollyVoiceId {
  return POLLY_VOICE_ID_SET.has(value);
}

function isPollyEngine(value: string): value is PollyEngine {
  return POLLY_ENGINE_SET.has(value);
}

function isPollyTextType(value: string): value is PollyTextType {
  return POLLY_TEXT_TYPE_SET.has(value);
}

function validateSpeechRequest(request: SpeechSynthesisRequest): void {
  if (request.tenantId.trim().length === 0) {
    throw new Error("Speech synthesis tenantId is required");
  }
  if (request.text.trim().length === 0) {
    throw new Error("Speech synthesis text is required");
  }
  if (request.text.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `Speech synthesis text must be ${MAX_TEXT_LENGTH} characters or fewer`,
    );
  }
}

function pcmDurationMs(byteLength: number): number {
  const totalSamples = byteLength / (PCM_BYTES_PER_SAMPLE * PCM_CHANNELS);
  return Math.round((totalSamples / PCM_SAMPLE_RATE_HZ) * 1000);
}

// Wraps headerless PCM samples in a minimal 44-byte RIFF/WAVE header so
// the stored object is a real, standalone-playable audio/wav file (raw
// PCM alone has no container and isn't decodable as "valid audio" by a
// standard player) -- fixed, well-known binary layout, no dependency.
function wrapPcmAsWav(pcm: Buffer): Buffer {
  const byteRate = PCM_SAMPLE_RATE_HZ * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;
  const blockAlign = PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20); // AudioFormat: 1 = PCM
  header.writeUInt16LE(PCM_CHANNELS, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE_HZ, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BYTES_PER_SAMPLE * 8, 34); // BitsPerSample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.byteLength, 40);

  return Buffer.concat([header, pcm]);
}

// Mirrors S3ObjectStorageProvider's toBuffer handling of AWS's
// StreamingBlobTypes response bodies (same union type family Polly's
// AudioStream uses): either a Uint8Array directly, or an object exposing
// transformToByteArray().
async function readAudioStream(body: unknown): Promise<Buffer> {
  if (body === undefined) {
    throw new Error("Polly SynthesizeSpeech response contained no audio stream");
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (
    typeof body === "object" &&
    body !== null &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    const bytes = (await body.transformToByteArray()) as Uint8Array;
    return Buffer.from(bytes);
  }
  throw new Error("Polly SynthesizeSpeech AudioStream is empty or unsupported");
}

// Mirrors TitanImageProvider's newImageId()/artifacts.service.ts's
// newArtifactId(): a randomUUID with the version nibble forced to 7, so
// generated IDs stay UUIDv7-shaped like every other ID convention in
// this repo, prefixed for this resource kind. "tts_" rather than "aud_"
// to avoid colliding with packages/contracts/src/ids.ts's existing
// AuditIdSchema (prefixedUuidV7("aud")) -- unrelated resource, same
// three letters would read confusingly next to real audit IDs.
function newSpeechAudioId(): string {
  const id = randomUUID();
  return `tts_${id.slice(0, 14)}7${id.slice(15)}`;
}
