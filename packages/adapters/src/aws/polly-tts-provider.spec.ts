import { SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import {
  assertProviderContractParity,
  createMockObjectStorageProvider,
  createMockTextToSpeechProvider,
  textToSpeechProviderContract,
  type TextToSpeechProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  POLLY_TTS_CAPABILITIES,
  PollyTtsProvider,
  type PollyCommandClient,
} from "./polly-tts-provider";

const FIXED_CHECKED_AT = "2026-07-24T00:00:00.000Z";
const PCM_SAMPLE_RATE_HZ = 16_000;
const PCM_BYTES_PER_SAMPLE = 2;

// A fixed-length fake PCM buffer at Polly's documented pcm layout
// (16-bit signed, mono, little-endian, 16kHz) -- real byte layout, not
// garbage, sized to a round duration so the math is easy to check.
function fakePcm(durationMs: number): Uint8Array {
  const sampleCount = (durationMs / 1000) * PCM_SAMPLE_RATE_HZ;
  return new Uint8Array(sampleCount * PCM_BYTES_PER_SAMPLE).fill(0x11);
}

function requestInput(command: SynthesizeSpeechCommand): Record<string, unknown> {
  return command.input as unknown as Record<string, unknown>;
}

function fakeClient(
  handler: (command: SynthesizeSpeechCommand) => Promise<{ readonly AudioStream: Uint8Array }>,
): PollyCommandClient {
  return {
    send: vi.fn(async (command: SynthesizeSpeechCommand) => handler(command)),
  } as unknown as PollyCommandClient;
}

function successClient(durationMs = 500): PollyCommandClient {
  return fakeClient(async () => ({ AudioStream: fakePcm(durationMs) }));
}

function realProvider(): TextToSpeechProvider {
  return new PollyTtsProvider(
    { region: "ap-south-1", bucketName: "alterx-media" },
    createMockObjectStorageProvider(),
    successClient(500),
    () => new Date(FIXED_CHECKED_AT),
  );
}

function equivalentMockProvider(): TextToSpeechProvider {
  return createMockTextToSpeechProvider({
    capabilities: POLLY_TTS_CAPABILITIES,
    health: {
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: { configured: true, liveProbe: false },
    },
    // The contract's own fixtures use the same text for every call, so a
    // fixed-duration override matching the real adapter's fixed-length
    // fake AudioStream (see successClient) keeps real-vs-mock parity
    // comparing like fixtures.
    synthesizeSpeech: async () => ({
      reference: "mock-speech://polly-parity-fixture",
      mimeType: "audio/wav",
      durationMs: 500,
    }),
  });
}

describe("PollyTtsProvider", () => {
  it("sends a Polly SynthesizeSpeech request for pcm output with the given voice", async () => {
    const send = vi.fn(async (command: SynthesizeSpeechCommand) => {
      expect(requestInput(command)).toEqual({
        Text: "hello there",
        OutputFormat: "pcm",
        SampleRate: "16000",
        VoiceId: "Joanna",
      });
      return { AudioStream: fakePcm(500) };
    });
    const provider = new PollyTtsProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      { send } as unknown as PollyCommandClient,
    );

    const result = await provider.synthesizeSpeech({
      tenantId: "tenant-1",
      text: "hello there",
      voiceConfig: { voiceId: "Joanna" },
    });

    expect(result).toEqual({
      reference: expect.stringMatching(
        /^s3:\/\/alterx-media\/tenants\/tenant-1\/media\/audio\/tts_[0-9a-f-]+\.wav$/,
      ),
      mimeType: "audio/wav",
      durationMs: 500,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("passes engine and textType through when provided", async () => {
    const send = vi.fn(async (command: SynthesizeSpeechCommand) => {
      expect(requestInput(command)).toMatchObject({
        VoiceId: "Matthew",
        Engine: "neural",
        TextType: "ssml",
      });
      return { AudioStream: fakePcm(200) };
    });
    const provider = new PollyTtsProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      { send } as unknown as PollyCommandClient,
    );

    await provider.synthesizeSpeech({
      tenantId: "tenant-1",
      text: "<speak>hi</speak>",
      voiceConfig: { voiceId: "Matthew", engine: "neural", textType: "ssml" },
    });
  });

  it("computes exact duration from PCM byte length and stores a playable WAV", async () => {
    const objectStorage = createMockObjectStorageProvider();
    const provider = new PollyTtsProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objectStorage,
      successClient(1_000), // exactly 1 second: 16000 samples * 2 bytes
    );

    const result = await provider.synthesizeSpeech({
      tenantId: "tenant-1",
      text: "one second of audio",
      voiceConfig: { voiceId: "Joanna" },
    });

    expect(result.durationMs).toBe(1_000);
    const stored = await objectStorage.getObject(result.reference);
    expect(stored.byteLength).toBe(44 + 16_000 * 2);
    expect(stored.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(stored.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(stored.subarray(12, 16).toString("ascii")).toBe("fmt ");
    expect(stored.readUInt16LE(20)).toBe(1); // AudioFormat: PCM
    expect(stored.readUInt16LE(22)).toBe(1); // NumChannels: mono
    expect(stored.readUInt32LE(24)).toBe(16_000); // SampleRate
    expect(stored.readUInt16LE(34)).toBe(16); // BitsPerSample
    expect(stored.subarray(36, 40).toString("ascii")).toBe("data");
    expect(stored.readUInt32LE(40)).toBe(16_000 * 2); // data chunk size
    expect(Buffer.compare(stored.subarray(44), Buffer.from(fakePcm(1_000)))).toBe(0);
  });

  it("supports a standalone call with no runId or nodeExecutionId", async () => {
    const provider = new PollyTtsProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      successClient(),
    );

    await expect(
      provider.synthesizeSpeech({
        tenantId: "tenant-1",
        text: "a standalone test",
        voiceConfig: { voiceId: "Joanna" },
      }),
    ).resolves.toMatchObject({ mimeType: "audio/wav" });
  });

  it("rejects invalid request shapes", async () => {
    const provider = new PollyTtsProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      successClient(),
    );

    await expect(
      provider.synthesizeSpeech({ tenantId: "", text: "x", voiceConfig: { voiceId: "Joanna" } }),
    ).rejects.toThrow(/tenantId/);
    await expect(
      provider.synthesizeSpeech({ tenantId: "t", text: "", voiceConfig: { voiceId: "Joanna" } }),
    ).rejects.toThrow(/text is required/);
    await expect(
      provider.synthesizeSpeech({
        tenantId: "t",
        text: "x".repeat(6_001),
        voiceConfig: { voiceId: "Joanna" },
      }),
    ).rejects.toThrow(/6000 characters or fewer/);
    await expect(
      provider.synthesizeSpeech({ tenantId: "t", text: "x", voiceConfig: {} }),
    ).rejects.toThrow(/voiceId is required/);
    await expect(
      provider.synthesizeSpeech({
        tenantId: "t",
        text: "x",
        voiceConfig: { voiceId: "NotARealVoice" },
      }),
    ).rejects.toThrow(/not a known Polly voice/);
    await expect(
      provider.synthesizeSpeech({
        tenantId: "t",
        text: "x",
        voiceConfig: { voiceId: "Joanna", engine: "turbo" },
      }),
    ).rejects.toThrow(/engine must be one of/);
    await expect(
      provider.synthesizeSpeech({
        tenantId: "t",
        text: "x",
        voiceConfig: { voiceId: "Joanna", textType: "markdown" },
      }),
    ).rejects.toThrow(/textType must be one of/);
  });

  it("rejects a response with no audio stream", async () => {
    const provider = new PollyTtsProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      fakeClient(async () => ({ AudioStream: undefined }) as never),
    );

    await expect(
      provider.synthesizeSpeech({
        tenantId: "t",
        text: "x",
        voiceConfig: { voiceId: "Joanna" },
      }),
    ).rejects.toThrow(/no audio stream/);
  });

  it("validates required config at construction", () => {
    const objectStorage = createMockObjectStorageProvider();
    expect(
      () => new PollyTtsProvider({ region: "", bucketName: "b" }, objectStorage),
    ).toThrow(/region/);
    expect(
      () => new PollyTtsProvider({ region: "ap-south-1", bucketName: "" }, objectStorage),
    ).toThrow(/bucket name/);
  });

  it("reports configured health without making a live Polly call", async () => {
    const send = vi.fn();
    const provider = new PollyTtsProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      { send } as unknown as PollyCommandClient,
      () => new Date(FIXED_CHECKED_AT),
    );

    await expect(provider.healthCheck()).resolves.toEqual({
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: { configured: true, liveProbe: false },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("destroys the underlying client on close", () => {
    const destroy = vi.fn();
    const provider = new PollyTtsProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      createMockObjectStorageProvider(),
      { send: vi.fn(), destroy } as unknown as PollyCommandClient,
    );

    provider.close();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("TextToSpeechProvider contract", () => {
  it("passes the unmodified shared contract suite with the real Polly adapter", async () => {
    const report = await assertProviderContractParity(textToSpeechProviderContract, [
      { name: "polly-primary", create: async () => realProvider() },
      { name: "polly-parity", create: async () => realProvider() },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });

  it("passes the unmodified shared contract suite across the real adapter and the mock", async () => {
    const report = await assertProviderContractParity(textToSpeechProviderContract, [
      { name: "polly-real", create: async () => realProvider() },
      { name: "polly-mock", create: async () => equivalentMockProvider() },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });
});
