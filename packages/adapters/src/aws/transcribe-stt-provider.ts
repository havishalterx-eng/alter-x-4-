import { randomUUID } from "node:crypto";

import {
  DeleteTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
  type DeleteTranscriptionJobCommandOutput,
  type GetTranscriptionJobCommandOutput,
  type StartTranscriptionJobCommandOutput,
} from "@aws-sdk/client-transcribe";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  ObjectStorageProvider,
  ProviderHealth,
  ProviderMetadata,
  SpeechToTextProvider,
  SpeechTranscriptionRequest,
  SpeechTranscriptionResult,
} from "@alterx/shared-clients";

// AWS Transcribe's real API shape, verified against AWS's own current
// documentation (not guessed):
// https://docs.aws.amazon.com/transcribe/latest/APIReference/API_StartTranscriptionJob.html
// https://docs.aws.amazon.com/transcribe/latest/APIReference/API_TranscriptionJob.html
// https://docs.aws.amazon.com/transcribe/latest/dg/how-input.html
//
// Confirmed there:
// - Unlike Bedrock/Polly, Transcribe is async and job-based:
//   StartTranscriptionJob returns immediately with the job QUEUED/
//   IN_PROGRESS; GetTranscriptionJob must be polled until
//   TranscriptionJobStatus is COMPLETED or FAILED (the full enum is
//   QUEUED | IN_PROGRESS | FAILED | COMPLETED).
// - Media.MediaFileUri takes a real s3://bucket/key URI directly -- the
//   exact format SpeechTranscriptionRequest.audioRef already carries
//   (S3ObjectStorageProvider's own reference convention), so audioRef
//   needs no transformation before being handed to Transcribe.
// - TranscriptionJobName must be unique per account/region, matches
//   ^[0-9a-zA-Z._-]+, max 200 chars -- minted per call, not reused.
// - OutputBucketName takes a bare bucket name ("Do not include the
//   S3:// prefix"), separate from OutputKey, which together determine
//   where the completed transcript JSON is written. Rather than parse
//   TranscriptionJob.Transcript.TranscriptFileUri back out (which AWS's
//   own docs mark as EITHER an s3:// URI or a temporary https:// URL
//   depending on configuration), this adapter reads the transcript back
//   from the exact s3://<bucket>/<outputKey> location it already chose
//   -- no URI-format sniffing needed.
// - The completed transcript JSON's real shape (confirmed via AWS's
//   "Data input and output" doc's own worked example):
//   {jobName, accountId, results: {transcripts: [{transcript}],
//   items: [{id, start_time?, end_time?, alternatives: [{confidence,
//   content}], type: "pronunciation" | "punctuation"}]}, status}.
//   `confidence` is a STRING ("1.0", "0.0"), not a number.
export interface TranscribeSttProviderConfig {
  readonly region: string;
  readonly bucketName: string;
  /** Delay between GetTranscriptionJob polls. Default 5000ms. */
  readonly pollIntervalMs?: number;
  /**
   * Overall ceiling on how long transcribe() waits for the job to finish
   * before throwing. Default 300_000ms (5 minutes) -- deliberately far
   * below Transcribe's own documented 4-hour maximum batch media
   * duration (a workflow-node or BFF test caller shouldn't hang for
   * hours; override this for genuinely long audio).
   */
  readonly maxWaitMs?: number;
}

export interface TranscribeCommandClient {
  send(command: StartTranscriptionJobCommand): Promise<StartTranscriptionJobCommandOutput>;
  send(command: GetTranscriptionJobCommand): Promise<GetTranscriptionJobCommandOutput>;
  send(command: DeleteTranscriptionJobCommand): Promise<DeleteTranscriptionJobCommandOutput>;
  destroy?(): void;
}

export const TRANSCRIBE_STT_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: false,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 10_485_760,
  supported_languages: [],
  cost_model: { rates: [] },
};

const TRANSCRIBE_STT_METADATA: ProviderMetadata<"SpeechToTextProvider"> = {
  providerId: "aws-transcribe",
  interfaceName: "SpeechToTextProvider",
  displayName: "AWS Transcribe",
  version: "gateways-v1",
  telemetryNamespace: "alterx.adapters.aws.transcribe",
  supportsTenantOverrides: false,
  migration: {
    strategyVersion: "aws-transcribe-v1",
    rollbackSupported: true,
  },
};

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 300_000;

interface TranscriptItem {
  readonly type?: string;
  readonly alternatives?: ReadonlyArray<{ readonly confidence?: string }>;
}

interface TranscriptOutput {
  readonly results?: {
    readonly transcripts?: ReadonlyArray<{ readonly transcript?: string }>;
    readonly items?: readonly TranscriptItem[];
  };
}

export class TranscribeSttProvider implements SpeechToTextProvider {
  readonly metadata = TRANSCRIBE_STT_METADATA;
  readonly capabilities = TRANSCRIBE_STT_CAPABILITIES;

  readonly #client: TranscribeCommandClient;
  readonly #bucketName: string;
  readonly #pollIntervalMs: number;
  readonly #maxWaitMs: number;
  readonly #objectStorage: ObjectStorageProvider;
  readonly #now: () => Date;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(
    config: TranscribeSttProviderConfig,
    objectStorage: ObjectStorageProvider,
    client?: TranscribeCommandClient,
    now?: () => Date,
    sleep?: (ms: number) => Promise<void>,
  ) {
    if (config.region.trim().length === 0) {
      throw new Error("Transcribe region is required");
    }
    if (config.bucketName.trim().length === 0) {
      throw new Error("Transcribe output bucket name is required");
    }
    this.#bucketName = config.bucketName;
    this.#pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#maxWaitMs = config.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.#objectStorage = objectStorage;
    this.#client = client ?? new TranscribeClient({ region: config.region });
    this.#now = now ?? (() => new Date());
    this.#sleep =
      sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async transcribe(
    request: SpeechTranscriptionRequest,
  ): Promise<SpeechTranscriptionResult> {
    validateTranscriptionRequest(request);

    const jobName = newTranscriptionJobId();
    const outputKey = `tenants/${request.tenantId}/media/transcripts/${jobName}.json`;
    const outputReference = `s3://${this.#bucketName}/${outputKey}`;

    await this.#client.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        Media: { MediaFileUri: request.audioRef },
        // No per-call language hint exists on SpeechTranscriptionRequest
        // (unlike ImageGenerationRequest/SpeechSynthesisRequest, it
        // carries no options bag), so automatic language identification
        // is the honest choice here rather than hardcoding one language
        // for every tenant/call.
        IdentifyLanguage: true,
        OutputBucketName: this.#bucketName,
        OutputKey: outputKey,
      }),
    );

    try {
      const job = await this.#pollUntilDone(jobName);
      if (job.TranscriptionJobStatus === "FAILED") {
        throw new Error(
          `Transcribe job failed: ${job.FailureReason ?? "unknown reason"}`,
        );
      }

      const raw = await this.#objectStorage.getObject(outputReference);
      const parsed = JSON.parse(raw.toString("utf8")) as TranscriptOutput;
      return parseTranscriptOutput(parsed);
    } finally {
      await this.#cleanup(jobName, outputReference);
    }
  }

  async #pollUntilDone(
    jobName: string,
  ): Promise<NonNullable<GetTranscriptionJobCommandOutput["TranscriptionJob"]>> {
    const deadline = this.#now().getTime() + this.#maxWaitMs;
    for (;;) {
      const response = await this.#client.send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
      );
      const job = response.TranscriptionJob;
      if (job === undefined) {
        throw new Error("GetTranscriptionJob returned no TranscriptionJob");
      }
      if (job.TranscriptionJobStatus === "COMPLETED" || job.TranscriptionJobStatus === "FAILED") {
        return job;
      }
      if (this.#now().getTime() >= deadline) {
        throw new Error(
          `Transcribe job did not complete within ${this.#maxWaitMs}ms`,
        );
      }
      await this.#sleep(this.#pollIntervalMs);
    }
  }

  async #cleanup(jobName: string, outputReference: string): Promise<void> {
    // Best-effort: a real transcription result (or a real failure error)
    // already produced above must not be masked by a cleanup hiccup.
    // DeleteTranscriptionJobCommand only removes the job record, not the
    // S3 output object it wrote -- both are deleted so neither leaks.
    try {
      await this.#client.send(
        new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName }),
      );
    } catch {
      // ignore
    }
    try {
      await this.#objectStorage.deleteObject(outputReference);
    } catch {
      // ignore
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    // Transcribe jobs cost real money per call, same reasoning as the
    // other AWS media adapters: report healthy once constructed, don't
    // spend money on a live probe.
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

function validateTranscriptionRequest(request: SpeechTranscriptionRequest): void {
  if (request.tenantId.trim().length === 0) {
    throw new Error("Speech transcription tenantId is required");
  }
  if (request.audioRef.trim().length === 0) {
    throw new Error("Speech transcription audioRef is required");
  }
  let url: URL;
  try {
    url = new URL(request.audioRef);
  } catch {
    throw new Error("Speech transcription audioRef must be a valid s3:// URL");
  }
  if (url.protocol !== "s3:" || url.hostname.length === 0 || url.pathname.length <= 1) {
    throw new Error("Speech transcription audioRef must be a valid s3:// URL");
  }
}

// Aggregates Transcribe's per-word confidence into the single score
// SpeechTranscriptionResult.confidence requires. Confirmed against a real
// transcript JSON example in AWS's own documentation: punctuation items
// always report confidence "0.0" -- that's not a real recognition signal,
// just how punctuation is represented, so averaging every item (including
// punctuation) would understate confidence for any transcript with normal
// punctuation. The mean is taken over pronunciation items only.
function parseTranscriptOutput(parsed: TranscriptOutput): SpeechTranscriptionResult {
  const transcript = parsed.results?.transcripts?.[0]?.transcript ?? "";
  const items = parsed.results?.items ?? [];
  const pronunciationScores = items
    .filter((item) => item.type === "pronunciation")
    .map((item) => Number.parseFloat(item.alternatives?.[0]?.confidence ?? "0"))
    .filter((score) => Number.isFinite(score));

  const mean =
    pronunciationScores.length === 0
      ? 0
      : pronunciationScores.reduce((sum, score) => sum + score, 0) /
        pronunciationScores.length;
  // Rounded to avoid handing callers binary floating-point noise
  // (e.g. 0.9299999999999999) for what is fundamentally a 2-3 decimal
  // digit precision score in the source data.
  const confidence = Math.round(mean * 10_000) / 10_000;

  return { transcript, confidence };
}

// Mirrors TitanImageProvider's newImageId()/PollyTtsProvider's
// newSpeechAudioId(): a randomUUID with the version nibble forced to 7,
// so generated IDs stay UUIDv7-shaped like every other ID convention in
// this repo. "stt_" doesn't collide with any prefix already reserved in
// packages/contracts/src/ids.ts.
function newTranscriptionJobId(): string {
  const id = randomUUID();
  return `stt_${id.slice(0, 14)}7${id.slice(15)}`;
}
