import { describe, expect, it, vi } from "vitest";
import {
  TitanImageProvider,
  PollyTtsProvider,
  TranscribeSttProvider,
} from "@alterx/adapters";
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
import { MediaService } from "./media.service";

const INSTANCE = "/api/v1/media/test";

describe("MediaService (fake providers -- validates wiring, mapping, and error shape)", () => {
  function setup(overrides: {
    readonly image?: ImageGenProvider;
    readonly tts?: TextToSpeechProvider;
    readonly stt?: SpeechToTextProvider;
    readonly objects?: ObjectStorageProvider;
  } = {}) {
    const objects = overrides.objects ?? createMockObjectStorageProvider();
    const image = overrides.image ?? createMockImageGenProvider();
    const tts = overrides.tts ?? createMockTextToSpeechProvider();
    const stt = overrides.stt ?? createMockSpeechToTextProvider();
    return { service: new MediaService(image, tts, stt, objects), objects, image, tts, stt };
  }

  it("generates an image without a run context and returns a signed, output-shaped result", async () => {
    const { service } = setup();
    const result = await service.generateImage(
      "tenant-1",
      { prompt: "a red bicycle", options: { width: 512 } },
      INSTANCE,
    );

    expect(result).toMatchObject({ mime_type: "image/png", width: 512, height: 512 });
    expect(result.signed_url).toContain("download?reference=");
    expect(new Date(result.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(result).not.toHaveProperty("provider");
  });

  it("passes prompt/options through to the image provider verbatim, with no runId/nodeExecutionId", async () => {
    const image = createMockImageGenProvider();
    const { service } = setup({ image });
    await service.generateImage("tenant-1", { prompt: "a blue car", options: { seed: 7 } }, INSTANCE);

    const requests = (image as unknown as { getRequests(): readonly unknown[] }).getRequests();
    expect(requests).toEqual([
      { tenantId: "tenant-1", prompt: "a blue car", options: { seed: 7 } },
    ]);
  });

  it("synthesizes speech and returns a signed, output-shaped result with duration_ms", async () => {
    const { service } = setup();
    const result = await service.synthesizeSpeech(
      "tenant-1",
      { text: "hello there", voiceConfig: { voiceId: "Joanna" } },
      INSTANCE,
    );

    expect(result.mime_type).toBe("audio/mpeg");
    expect(result.duration_ms).toBeGreaterThan(0);
    expect(result.signed_url).toContain("download?reference=");
  });

  it("transcribes audio and returns a real-shaped transcript/confidence result", async () => {
    const { service } = setup();
    const result = await service.transcribe(
      "tenant-1",
      { audioRef: "s3://bucket/clip.wav" },
      INSTANCE,
    );

    expect(typeof result.transcript).toBe("string");
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe("MediaService with real adapter classes (SDK calls faked, not the adapter logic)", () => {
  const ONE_PIXEL_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

  // The real S3ObjectStorageProvider has its own separate contract-suite
  // coverage; it isn't one of the 3 media adapters this PR wires, so the
  // in-memory ObjectStorageProvider mock stands in here for it -- same
  // technique each of the 3 real adapters' own spec files already use for
  // this exact dependency. What's under test is the real image-gen/tts/
  // stt adapter classes and MediaService's wiring around them.
  function fakeObjectStorage(): ObjectStorageProvider {
    return createMockObjectStorageProvider();
  }

  it("produces a real-shaped, non-placeholder image result through the full route -> service -> adapter chain", async () => {
    const objects = fakeObjectStorage();
    const imageProvider = new TitanImageProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objects,
      {
        send: vi.fn(async () => ({
          body: new TextEncoder().encode(JSON.stringify({ images: [ONE_PIXEL_PNG_BASE64] })),
        })),
      } as unknown as ConstructorParameters<typeof TitanImageProvider>[2],
    );
    const service = new MediaService(
      imageProvider,
      createMockTextToSpeechProvider(),
      createMockSpeechToTextProvider(),
      objects,
    );

    const result = await service.generateImage("tenant-1", { prompt: "a cat", options: {} }, INSTANCE);

    expect(result).toMatchObject({ mime_type: "image/png", width: 1408, height: 1408 });
    expect(result.signed_url).toContain("download?reference=");
  });

  it("produces a real-shaped, non-placeholder speech result through the full route -> service -> adapter chain", async () => {
    const objects = fakeObjectStorage();
    const pcm = new Uint8Array(16_000 * 2).fill(0x11); // exactly 1s at 16kHz/16-bit/mono
    const ttsProvider = new PollyTtsProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objects,
      { send: vi.fn(async () => ({ AudioStream: pcm })) } as unknown as ConstructorParameters<
        typeof PollyTtsProvider
      >[2],
    );
    const service = new MediaService(
      createMockImageGenProvider(),
      ttsProvider,
      createMockSpeechToTextProvider(),
      objects,
    );

    const result = await service.synthesizeSpeech(
      "tenant-1",
      { text: "hello", voiceConfig: { voiceId: "Joanna" } },
      INSTANCE,
    );

    expect(result).toMatchObject({ mime_type: "audio/wav", duration_ms: 1_000 });
    expect(result.signed_url).toContain("download?reference=");
  });

  it("produces a real-shaped, non-placeholder transcript through the full route -> service -> adapter chain", async () => {
    const objects = fakeObjectStorage();
    const transcriptJson = JSON.stringify({
      results: {
        transcripts: [{ transcript: "hello world." }],
        items: [
          { alternatives: [{ confidence: "0.99", content: "hello" }], type: "pronunciation" },
          { alternatives: [{ confidence: "0.87", content: "world" }], type: "pronunciation" },
          { alternatives: [{ confidence: "0.0", content: "." }], type: "punctuation" },
        ],
      },
      status: "COMPLETED",
    });
    const sttProvider = new TranscribeSttProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objects,
      {
        send: vi.fn(async (command: unknown) => {
          const typed = command as { constructor: { name: string }; input: Record<string, unknown> };
          if (typed.constructor.name === "StartTranscriptionJobCommand") {
            const reference = `s3://${typed.input.OutputBucketName as string}/${typed.input.OutputKey as string}`;
            await objects.putObject(reference, Buffer.from(transcriptJson), "application/json");
            return { TranscriptionJob: { TranscriptionJobStatus: "IN_PROGRESS" } };
          }
          if (typed.constructor.name === "GetTranscriptionJobCommand") {
            return { TranscriptionJob: { TranscriptionJobStatus: "COMPLETED" } };
          }
          return {};
        }),
      } as unknown as ConstructorParameters<typeof TranscribeSttProvider>[2],
      undefined,
      () => Promise.resolve(),
    );
    const service = new MediaService(
      createMockImageGenProvider(),
      createMockTextToSpeechProvider(),
      sttProvider,
      objects,
    );

    const result = await service.transcribe(
      "tenant-1",
      { audioRef: "s3://alterx-media/tenants/tenant-1/media/audio/clip.wav" },
      INSTANCE,
    );

    expect(result).toEqual({ transcript: "hello world.", confidence: 0.93 });
  });
});
