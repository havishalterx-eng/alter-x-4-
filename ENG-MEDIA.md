# ENG-MEDIA — Media capabilities (image generation, TTS, STT)

Owner: Engine. **Status: shipped.** Delivered across PRs #83–#87.

This document previously described work to be done. That work is complete, so
it now describes what exists. Read it as a reference to the shipped surface,
not as a work order.

## What shipped

### Interfaces (PR #83)

`packages/shared-clients/src/provider-types.ts` declares three provider
interfaces in `CANONICAL_PROVIDER_INTERFACES`:

- `ImageGenProvider.generateImage(ImageGenerationRequest): Promise<ImageGenerationResult>`
- `TextToSpeechProvider.synthesizeSpeech(SpeechSynthesisRequest): Promise<SpeechSynthesisResult>`
- `SpeechToTextProvider.transcribe(SpeechTranscriptionRequest): Promise<SpeechTranscriptionResult>`

`SpeechTranscriptionRequest.audioRef` and `SpeechSynthesisResult.reference`
are opaque `ObjectStorageProvider` references — audio bytes never cross the
RPC directly, matching `PIIRedactionProvider`'s pattern one interface over.

**Run-context question — resolved.** The original draft flagged an open
question: these interfaces were shaped for use inside a workflow run
(`runId`, `nodeExecutionId`), but a standalone "test this media config" call
has no run to attach to. Option (a) was chosen and implemented: `runId` and
`nodeExecutionId` are now **optional** on all three request interfaces, while
`tenantId` remains required, since every real call has a tenant. The change
was additive — a repo-wide grep confirmed zero existing callers at the time.

Three mocks live in `packages/shared-clients/src/mocks/`, each passing its
`ProviderContractSuite`.

### Adapters (PRs #84, #85, #86)

- `packages/adapters/src/aws/titan-image-provider.ts` — Amazon Titan Image Generator
- `packages/adapters/src/aws/polly-tts-provider.ts` — AWS Polly
- `packages/adapters/src/aws/transcribe-stt-provider.ts` — AWS Transcribe

Two implementation notes worth keeping:

**Polly duration.** Polly's response carries no duration field. The adapter
requests PCM output (16 kHz, 16-bit, mono) and computes exact `durationMs`
from byte length, then wraps the raw PCM in a WAV header so the delivered
file is playable. No audio-decoding dependency was added.

**Transcribe confidence.** Transcribe's async job API is handled behind the
interface's single-`Promise` method via an injectable sleep and a
configurable timeout; both the job record and its S3 output object are
cleaned up on every path. Confidence is averaged over
`type === "pronunciation"` items only — punctuation items always report
`"0.0"`, so a naive whole-transcript average understates every result.

### BFF routes (PR #87)

`apps/platform-api/src/media/` exposes three vendor-neutral routes:

- `POST /api/v1/media/image`
- `POST /api/v1/media/tts`
- `POST /api/v1/media/stt`

No vendor name appears in any route path or response field. Provider
resolution goes through `packages/shared-clients/src/capability-registry.ts` —
this module was its first real consumer. Capabilities are registered at
startup and resolved via `registry.resolve({})`, with no hardcoded branching
on provider name.

Credentials-optional boot is handled by
`packages/adapters/src/aws/resolve-media-providers.ts`, mirroring
`resolveEmailProvider()`'s mock-in-production-is-fatal pattern. The app boots
with zero media credentials configured.

Image and TTS return a signed download URL, mirroring `artifacts.service.ts`'s
`download()` rather than passing raw bytes through the BFF.

## Vendor divergence — deliberate, recorded

This document originally recommended **Sarvam** as the single reference vendor
for TTS and STT, reasoning that one vendor avoids the "three integrations
hardcoded" trap because `CapabilityRegistry` makes adding others additive.

The build used **AWS Titan, Polly and Transcribe** instead.

That divergence is recorded rather than quietly reconciled. The original
reasoning still holds and was satisfied by other means: `CapabilityRegistry`
binding keeps vendor swaps additive, and no vendor name leaked into a route
path or a response contract. Swapping in Sarvam later is a registry binding
change plus one adapter, with no platform-side code touched.

Anyone writing a spec, status report or handoff prompt covering media should
state the built reality (AWS) and note this departure — not quote the Sarvam
recommendation as though it described shipped state.

## Known gaps

- **No frontend.** The three routes have no interface in `platform-web`; there
  is no `media` feature area. The capability is currently headless.
- **STT input.** The STT route accepts an existing object-storage reference.
  No generic, non-ADS-specific presign mechanism exists to reuse, so building
  an upload path was deliberately deferred rather than invented.

## Audit checklist (still applicable to future changes)

- Vendor names in adapters only, never in routes or response contracts — a
  `/media/polly-tts` route is a blocker.
- Each adapter passes its `ProviderContractSuite`; declared capabilities match
  what the vendor can actually serve.
- Real output round-trips: TTS output decodes as valid audio for its declared
  `mimeType`, image output is a valid image for its declared format. A 200 with
  a placeholder payload is a blocker, not a pass.
- Capability resolution goes through `CapabilityRegistry`, never a hardcoded
  branch on provider name.
