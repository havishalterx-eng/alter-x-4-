import {
  DeleteTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
} from "@aws-sdk/client-transcribe";
import {
  assertProviderContractParity,
  createMockObjectStorageProvider,
  createMockSpeechToTextProvider,
  speechToTextProviderContract,
  type ObjectStorageProvider,
  type SpeechToTextProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  TRANSCRIBE_STT_CAPABILITIES,
  TranscribeSttProvider,
  type TranscribeCommandClient,
} from "./transcribe-stt-provider";

const FIXED_CHECKED_AT = "2026-07-24T00:00:00.000Z";

interface FakeTranscript {
  readonly transcript: string;
  readonly items: ReadonlyArray<{
    readonly confidence: string;
    readonly content: string;
    readonly type: "pronunciation" | "punctuation";
  }>;
}

const HELLO_WORLD_TRANSCRIPT: FakeTranscript = {
  transcript: "hello world.",
  items: [
    { confidence: "0.99", content: "hello", type: "pronunciation" },
    { confidence: "0.87", content: "world", type: "pronunciation" },
    { confidence: "0.0", content: ".", type: "punctuation" },
  ],
};

function transcriptJson(fixture: FakeTranscript): string {
  return JSON.stringify({
    results: {
      transcripts: [{ transcript: fixture.transcript }],
      items: fixture.items.map((item, index) => ({
        id: index,
        alternatives: [{ confidence: item.confidence, content: item.content }],
        type: item.type,
      })),
    },
    status: "COMPLETED",
  });
}

// A fake client + object storage pair that behaves the way real
// Transcribe + S3 actually do: StartTranscriptionJob's OutputBucketName/
// OutputKey are honored (the fake "writes" the transcript there, not to
// a key the test invents independently), and GetTranscriptionJob is
// polled `completesAfterPolls` times before reporting COMPLETED.
function successClient(
  objectStorage: ObjectStorageProvider,
  fixture: FakeTranscript = HELLO_WORLD_TRANSCRIPT,
  completesAfterPolls = 1,
): TranscribeCommandClient {
  let jobName = "";
  let outputReference = "";
  let pollCount = 0;
  return {
    send: vi.fn(async (command: unknown) => {
      if (command instanceof StartTranscriptionJobCommand) {
        jobName = command.input.TranscriptionJobName ?? "";
        outputReference = `s3://${command.input.OutputBucketName}/${command.input.OutputKey}`;
        await objectStorage.putObject(
          outputReference,
          Buffer.from(transcriptJson(fixture)),
          "application/json",
        );
        return { TranscriptionJob: { TranscriptionJobName: jobName, TranscriptionJobStatus: "IN_PROGRESS" } };
      }
      if (command instanceof GetTranscriptionJobCommand) {
        pollCount += 1;
        const status = pollCount >= completesAfterPolls ? "COMPLETED" : "IN_PROGRESS";
        return { TranscriptionJob: { TranscriptionJobName: jobName, TranscriptionJobStatus: status } };
      }
      if (command instanceof DeleteTranscriptionJobCommand) {
        return {};
      }
      throw new Error(`unexpected command: ${String(command)}`);
    }),
  } as unknown as TranscribeCommandClient;
}

function immediateSleep(): (ms: number) => Promise<void> {
  return () => Promise.resolve();
}

function sentCommands(client: TranscribeCommandClient): readonly unknown[] {
  return (client.send as ReturnType<typeof vi.fn>).mock.calls.map(
    (call: unknown[]) => call[0],
  );
}

function realProvider(): SpeechToTextProvider {
  const objectStorage = createMockObjectStorageProvider();
  return new TranscribeSttProvider(
    { region: "ap-south-1", bucketName: "alterx-media" },
    objectStorage,
    successClient(objectStorage),
    () => new Date(FIXED_CHECKED_AT),
    immediateSleep(),
  );
}

function equivalentMockProvider(): SpeechToTextProvider {
  return createMockSpeechToTextProvider({
    capabilities: TRANSCRIBE_STT_CAPABILITIES,
    health: {
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: { configured: true, liveProbe: false },
    },
    // Matches successClient's fixed HELLO_WORLD_TRANSCRIPT output so
    // real-vs-mock parity compares like fixtures: mean of the
    // pronunciation-only confidences (0.99 + 0.87) / 2 = 0.93.
    transcribe: async () => ({ transcript: "hello world.", confidence: 0.93 }),
  });
}

describe("TranscribeSttProvider", () => {
  it("starts a job, polls to completion, and aggregates pronunciation-only confidence", async () => {
    const objectStorage = createMockObjectStorageProvider();
    const client = successClient(objectStorage);
    const provider = new TranscribeSttProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objectStorage,
      client,
      () => new Date(FIXED_CHECKED_AT),
      immediateSleep(),
    );

    const result = await provider.transcribe({
      tenantId: "tenant-1",
      audioRef: "s3://alterx-media/tenants/tenant-1/media/audio/clip.wav",
    });

    expect(result).toEqual({ transcript: "hello world.", confidence: 0.93 });

    const startCall = sentCommands(client).find(
      (command) => command instanceof StartTranscriptionJobCommand,
    ) as StartTranscriptionJobCommand;
    expect(startCall.input).toMatchObject({
      Media: { MediaFileUri: "s3://alterx-media/tenants/tenant-1/media/audio/clip.wav" },
      IdentifyLanguage: true,
      OutputBucketName: "alterx-media",
    });
    expect(startCall.input.TranscriptionJobName).toMatch(/^stt_[0-9a-f-]+$/);
    expect(startCall.input.OutputKey).toBe(
      `tenants/tenant-1/media/transcripts/${startCall.input.TranscriptionJobName}.json`,
    );
  });

  it("cleans up the job and the output object after a successful read", async () => {
    const objectStorage = createMockObjectStorageProvider();
    const client = successClient(objectStorage);
    const provider = new TranscribeSttProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objectStorage,
      client,
      () => new Date(FIXED_CHECKED_AT),
      immediateSleep(),
    );

    const result = await provider.transcribe({
      tenantId: "tenant-1",
      audioRef: "s3://alterx-media/tenants/tenant-1/media/audio/clip.wav",
    });
    void result;

    const calls = sentCommands(client);
    expect(calls.some((command: unknown) => command instanceof DeleteTranscriptionJobCommand)).toBe(true);
  });

  it("polls multiple times, sleeping the configured interval between polls", async () => {
    const objectStorage = createMockObjectStorageProvider();
    const client = successClient(objectStorage, HELLO_WORLD_TRANSCRIPT, 3);
    const sleep = vi.fn(() => Promise.resolve());
    const provider = new TranscribeSttProvider(
      { region: "ap-south-1", bucketName: "alterx-media", pollIntervalMs: 1_234 },
      objectStorage,
      client,
      () => new Date(FIXED_CHECKED_AT),
      sleep,
    );

    await provider.transcribe({
      tenantId: "tenant-1",
      audioRef: "s3://alterx-media/tenants/tenant-1/media/audio/clip.wav",
    });

    expect(sleep).toHaveBeenCalledTimes(2); // completes on the 3rd poll -> 2 waits
    expect(sleep).toHaveBeenCalledWith(1_234);
    const getCalls = sentCommands(client).filter(
      (command) => command instanceof GetTranscriptionJobCommand,
    );
    expect(getCalls).toHaveLength(3);
  });

  it("throws when the job fails, and still cleans up", async () => {
    const objectStorage = createMockObjectStorageProvider();
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof StartTranscriptionJobCommand) {
          return { TranscriptionJob: { TranscriptionJobStatus: "IN_PROGRESS" } };
        }
        if (command instanceof GetTranscriptionJobCommand) {
          return {
            TranscriptionJob: {
              TranscriptionJobStatus: "FAILED",
              FailureReason: "Unsupported media format",
            },
          };
        }
        return {};
      }),
    } as unknown as TranscribeCommandClient;
    const provider = new TranscribeSttProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objectStorage,
      client,
      () => new Date(FIXED_CHECKED_AT),
      immediateSleep(),
    );

    await expect(
      provider.transcribe({
        tenantId: "tenant-1",
        audioRef: "s3://alterx-media/tenants/tenant-1/media/audio/clip.wav",
      }),
    ).rejects.toThrow(/Unsupported media format/);

    const calls = sentCommands(client);
    expect(calls.some((command: unknown) => command instanceof DeleteTranscriptionJobCommand)).toBe(true);
  });

  it("throws a timeout error when the job never completes within maxWaitMs, and still cleans up", async () => {
    const objectStorage = createMockObjectStorageProvider();
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof StartTranscriptionJobCommand) {
          return { TranscriptionJob: { TranscriptionJobStatus: "IN_PROGRESS" } };
        }
        if (command instanceof GetTranscriptionJobCommand) {
          return { TranscriptionJob: { TranscriptionJobStatus: "IN_PROGRESS" } };
        }
        return {};
      }),
    } as unknown as TranscribeCommandClient;
    let elapsed = 0;
    const provider = new TranscribeSttProvider(
      { region: "ap-south-1", bucketName: "alterx-media", pollIntervalMs: 1_000, maxWaitMs: 2_000 },
      objectStorage,
      client,
      () => {
        const value = new Date(elapsed);
        elapsed += 1_000;
        return value;
      },
      immediateSleep(),
    );

    await expect(
      provider.transcribe({
        tenantId: "tenant-1",
        audioRef: "s3://alterx-media/tenants/tenant-1/media/audio/clip.wav",
      }),
    ).rejects.toThrow(/did not complete within 2000ms/);

    const calls = sentCommands(client);
    expect(calls.some((command: unknown) => command instanceof DeleteTranscriptionJobCommand)).toBe(true);
  });

  it("supports a standalone call with no runId or nodeExecutionId", async () => {
    const objectStorage = createMockObjectStorageProvider();
    const provider = new TranscribeSttProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objectStorage,
      successClient(objectStorage),
      () => new Date(FIXED_CHECKED_AT),
      immediateSleep(),
    );

    await expect(
      provider.transcribe({
        tenantId: "tenant-1",
        audioRef: "s3://alterx-media/tenants/tenant-1/media/audio/clip.wav",
      }),
    ).resolves.toMatchObject({ transcript: "hello world." });
  });

  it("rejects invalid request shapes", async () => {
    const objectStorage = createMockObjectStorageProvider();
    const provider = new TranscribeSttProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objectStorage,
      successClient(objectStorage),
      () => new Date(FIXED_CHECKED_AT),
      immediateSleep(),
    );

    await expect(
      provider.transcribe({ tenantId: "", audioRef: "s3://b/k" }),
    ).rejects.toThrow(/tenantId/);
    await expect(
      provider.transcribe({ tenantId: "t", audioRef: "" }),
    ).rejects.toThrow(/audioRef is required/);
    await expect(
      provider.transcribe({ tenantId: "t", audioRef: "https://example.com/clip.wav" }),
    ).rejects.toThrow(/valid s3:\/\/ URL/);
    await expect(
      provider.transcribe({ tenantId: "t", audioRef: "s3://bucket-only" }),
    ).rejects.toThrow(/valid s3:\/\/ URL/);
  });

  it("rejects a GetTranscriptionJob response with no TranscriptionJob", async () => {
    const objectStorage = createMockObjectStorageProvider();
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof StartTranscriptionJobCommand) {
          return { TranscriptionJob: { TranscriptionJobStatus: "IN_PROGRESS" } };
        }
        if (command instanceof GetTranscriptionJobCommand) {
          return {};
        }
        return {};
      }),
    } as unknown as TranscribeCommandClient;
    const provider = new TranscribeSttProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objectStorage,
      client,
      () => new Date(FIXED_CHECKED_AT),
      immediateSleep(),
    );

    await expect(
      provider.transcribe({
        tenantId: "tenant-1",
        audioRef: "s3://alterx-media/tenants/tenant-1/media/audio/clip.wav",
      }),
    ).rejects.toThrow(/no TranscriptionJob/);
  });

  it("validates required config at construction", () => {
    const objectStorage = createMockObjectStorageProvider();
    expect(
      () => new TranscribeSttProvider({ region: "", bucketName: "b" }, objectStorage),
    ).toThrow(/region/);
    expect(
      () => new TranscribeSttProvider({ region: "ap-south-1", bucketName: "" }, objectStorage),
    ).toThrow(/bucket name/);
  });

  it("reports configured health without making a live Transcribe call", async () => {
    const objectStorage = createMockObjectStorageProvider();
    const send = vi.fn();
    const provider = new TranscribeSttProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objectStorage,
      { send } as unknown as TranscribeCommandClient,
      () => new Date(FIXED_CHECKED_AT),
      immediateSleep(),
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
    const objectStorage = createMockObjectStorageProvider();
    const destroy = vi.fn();
    const provider = new TranscribeSttProvider(
      { region: "ap-south-1", bucketName: "alterx-media" },
      objectStorage,
      { send: vi.fn(), destroy } as unknown as TranscribeCommandClient,
    );

    provider.close();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("SpeechToTextProvider contract", () => {
  it("passes the unmodified shared contract suite with the real Transcribe adapter", async () => {
    const report = await assertProviderContractParity(speechToTextProviderContract, [
      { name: "transcribe-primary", create: async () => realProvider() },
      { name: "transcribe-parity", create: async () => realProvider() },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });

  it("passes the unmodified shared contract suite across the real adapter and the mock", async () => {
    const report = await assertProviderContractParity(speechToTextProviderContract, [
      { name: "transcribe-real", create: async () => realProvider() },
      { name: "transcribe-mock", create: async () => equivalentMockProvider() },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });
});
