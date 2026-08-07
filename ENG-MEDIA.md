# ENG-MEDIA — Media capabilities (image generation, TTS, STT)

Owner: Engine. Real build.

Corrected against the actual repo state (`havishvardhan04-creator/ALTER-X-3`,
`main` post-#4-merge) — the original draft assumed a clean slate. It isn't
one. Verified by reading code, not `openapi.json`.

## What already exists (do not rebuild)

`packages/shared-clients/src/provider-types.ts` already declares, fully
typed, in `CANONICAL_PROVIDER_INTERFACES`:

- `ImageGenProvider.generateImage(ImageGenerationRequest): Promise<ImageGenerationResult>`
- `TextToSpeechProvider.synthesizeSpeech(SpeechSynthesisRequest): Promise<SpeechSynthesisResult>`
- `SpeechToTextProvider.transcribe(SpeechTranscriptionRequest): Promise<SpeechTranscriptionResult>`

These are **workflow-node-execution interfaces** — `SpeechSynthesisRequest`
carries `tenantId`, `runId`, `nodeExecutionId`, not a bare API call shape.
`SpeechTranscriptionRequest.audioRef` and `SpeechSynthesisResult.reference`
are opaque `ObjectStorageProvider` references — audio bytes never cross the
RPC directly, by design (matches `PIIRedactionProvider`'s pattern one
interface over). This is the correct shape for an Engine-internal provider
consumed by a node executor. It is **not** a REST-facing shape and should
not be treated as one.

## What's actually missing

1. **Zero adapters.** `grep -rl "implements.*TextToSpeechProvider\|implements.*SpeechToTextProvider\|implements.*ImageGenProvider" packages/adapters apps` — nothing. No real adapter, no mock. The interfaces exist; nothing implements them.
2. **Zero BFF exposure.** No `/media/*` route anywhere in `apps/platform-api`. The Connections-phase exit check ("each real provider call round-trips with real output") has no route to hit at all right now.

## Open architecture question — resolve before building, don't guess

The existing interfaces are shaped for **inside workflow execution**
(a node calling TTS mid-run, tied to `runId`/`nodeExecutionId`). The exit
check wants a **standalone test call** ("media config... round-trips with
real output — an audio/image byte-for-byte sanity check, not just a 200
status"), which implies a BFF route callable outside any workflow run.

Those are two different call shapes. Before building routes, decide:

- **(a)** Add a synchronous, run-context-free variant of each interface
  (or an optional `runId`/`nodeExecutionId`) so a BFF "test this media
  config" call and a real workflow-node call both go through one adapter,
  or
- **(b)** Treat the BFF test route as its own thin path that fabricates a
  throwaway run/node-execution context to satisfy the existing interface —
  workable, but adds fake IDs to real telemetry/audit trails, which the
  zero-mock law would flag if not disclosed.

Recommend **(a)**. Don't silently pick one without declaring it — the
platform side needs to know which shape it's calling.

## Deliver

1. Resolve the architecture question above; declare the chosen shape in
   `packages/contracts`.
2. One reference adapter per interface in `packages/adapters` — Sarvam for
   TTS+STT (single vendor, avoids the "three integrations hardcoded" trap
   since CapabilityRegistry makes adding Polly/Transcribe later additive,
   not a rewrite), a real image provider for `ImageGenProvider` or confirm
   it folds into `ModelProvider` instead (check `model-gateway` first — it
   may already cover this and a standalone `ImageGenProvider` adapter would
   be a duplicate surface).
3. A mock per interface in `shared-clients/mocks`, each passing its
   `ProviderContractSuite` — this is the framework's own gate before a route
   can go live, per the standing rule already documented in this repo:
   "a BFF route may be built against an interface using the framework's
   mock, but does not ship live until at least one real adapter is
   registered and passes its contract suite."
4. Vendor-neutral BFF routes: `/api/v1/media/tts`, `/api/v1/media/stt`,
   `/api/v1/media/image` (only if not folded into ModelProvider). No vendor
   name in any route path or response field — swapping Sarvam for Polly
   must be a `CapabilityRegistry` binding change, zero platform code touch.
5. Credentials via `SecretsProvider`, same vault already used by the OAuth
   connectors and Credential Vault — no new secret-storage mechanism.

## Tests

- Real output round-trips: TTS output decodes as valid audio for its
  declared `mimeType`; image output is a valid image for its declared
  format. A 200 with an empty or placeholder payload is a blocker, not a
  pass.
- Contract suite passes against the real adapter, not only the mock.
- No vendor name appears in any route path or response contract.
- App boots with zero media credentials configured — mirrors the
  "plug and play, no credentials for now" requirement already applied to
  the OAuth connectors: real adapter code, correctly disclosed `NOT_MET`
  for the live round-trip until credentials land.

## Audit checklist

- Vendor names in adapters only, never in routes or response contracts —
  a `/media/sarvam-tts` route is a blocker.
- Each adapter passes its `ProviderContractSuite`; declared capabilities
  (`supported_languages`, etc.) match what the vendor can actually serve —
  a provider claiming languages it can't serve is fabrication.
- Real output round-trips, not a placeholder payload.
- Capability resolution goes through `CapabilityRegistry`, never a
  hardcoded `if/else` on provider name.
- The run-context architecture question above was resolved and declared,
  not silently defaulted.
