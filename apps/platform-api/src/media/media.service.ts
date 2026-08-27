import { Inject, Injectable } from "@nestjs/common";
import type { ProviderCapabilities } from "@alterx/contracts";
import { CapabilityRegistry } from "@alterx/shared-clients";
import type {
  ImageGenProvider,
  ObjectStorageProvider,
  SpeechToTextProvider,
  TextToSpeechProvider,
} from "@alterx/shared-clients";
import { MediaHttpError } from "./problem";
import {
  IMAGE_GEN_PROVIDER,
  MEDIA_OBJECT_STORAGE,
  SPEECH_TO_TEXT_PROVIDER,
  TEXT_TO_SPEECH_PROVIDER,
} from "./tokens";
import type {
  GenerateImageInput,
  GeneratedImageResult,
  SynthesizeSpeechInput,
  SynthesizedSpeechResult,
  TranscribeInput,
  TranscriptionResult,
} from "./types";

const SIGNED_URL_TTL_SECONDS = 900;

interface CapableProvider {
  readonly metadata: { readonly providerId: string };
  readonly capabilities: ProviderCapabilities;
}

// Registers a provider under its own metadata.providerId/capabilities and
// records the constructed instance for lookup by that same ID. There's
// exactly one real candidate per media interface today (Sarvam was
// rejected in favor of AWS -- see ENG-MEDIA.md), so this registers just
// whichever single instance the credentials-optional resolver decided on
// (mock or real) -- adding a genuine second candidate later is a second
// register() call here, not a code branch anywhere in this service.
function register<TProvider extends CapableProvider>(
  registry: CapabilityRegistry,
  providers: Map<string, TProvider>,
  provider: TProvider,
): void {
  registry.register(provider.metadata.providerId, provider.capabilities);
  providers.set(provider.metadata.providerId, provider);
}

// Capability resolution goes through CapabilityRegistry.resolve(), never
// a hardcoded if/else or switch on provider name -- ENG-MEDIA.md's own
// audit checklist calls that out explicitly as the anti-pattern to avoid.
function resolveOne<TProvider extends CapableProvider>(
  registry: CapabilityRegistry,
  providers: Map<string, TProvider>,
  instance: string,
): TProvider {
  const [providerId] = registry.resolve({});
  const provider = providerId === undefined ? undefined : providers.get(providerId);
  if (provider === undefined) {
    throw new MediaHttpError(
      503,
      "MEDIA_PROVIDER_UNAVAILABLE",
      "No media provider is currently available",
      instance,
    );
  }
  return provider;
}

@Injectable()
export class MediaService {
  readonly #imageRegistry = new CapabilityRegistry();
  readonly #imageProviders = new Map<string, ImageGenProvider>();
  readonly #ttsRegistry = new CapabilityRegistry();
  readonly #ttsProviders = new Map<string, TextToSpeechProvider>();
  readonly #sttRegistry = new CapabilityRegistry();
  readonly #sttProviders = new Map<string, SpeechToTextProvider>();

  constructor(
    @Inject(IMAGE_GEN_PROVIDER) imageProvider: ImageGenProvider,
    @Inject(TEXT_TO_SPEECH_PROVIDER) ttsProvider: TextToSpeechProvider,
    @Inject(SPEECH_TO_TEXT_PROVIDER) sttProvider: SpeechToTextProvider,
    @Inject(MEDIA_OBJECT_STORAGE) private readonly objects: ObjectStorageProvider,
  ) {
    register(this.#imageRegistry, this.#imageProviders, imageProvider);
    register(this.#ttsRegistry, this.#ttsProviders, ttsProvider);
    register(this.#sttRegistry, this.#sttProviders, sttProvider);
  }

  // No runId/nodeExecutionId is passed to any of the three real
  // interfaces below -- these are exactly the standalone, run-context-
  // free calls stage 1 (ENG-MEDIA.md's resolved architecture question)
  // added optional runId/nodeExecutionId for.

  async generateImage(
    tenantId: string,
    input: GenerateImageInput,
    instance: string,
  ): Promise<GeneratedImageResult> {
    const provider = resolveOne(this.#imageRegistry, this.#imageProviders, instance);
    const result = await provider.generateImage({
      tenantId,
      prompt: input.prompt,
      options: input.options,
    });
    return {
      ...(await this.#sign(result.reference)),
      mime_type: result.mimeType,
      width: result.width,
      height: result.height,
    };
  }

  async synthesizeSpeech(
    tenantId: string,
    input: SynthesizeSpeechInput,
    instance: string,
  ): Promise<SynthesizedSpeechResult> {
    const provider = resolveOne(this.#ttsRegistry, this.#ttsProviders, instance);
    const result = await provider.synthesizeSpeech({
      tenantId,
      text: input.text,
      voiceConfig: input.voiceConfig,
    });
    return {
      ...(await this.#sign(result.reference)),
      mime_type: result.mimeType,
      duration_ms: result.durationMs,
    };
  }

  async transcribe(
    tenantId: string,
    input: TranscribeInput,
    instance: string,
  ): Promise<TranscriptionResult> {
    const provider = resolveOne(this.#sttRegistry, this.#sttProviders, instance);
    const result = await provider.transcribe({ tenantId, audioRef: input.audioRef });
    return { transcript: result.transcript, confidence: result.confidence };
  }

  async #sign(
    reference: string,
  ): Promise<{ readonly signed_url: string; readonly expires_at: string }> {
    const signedUrl = await this.objects.createPresignedDownloadUrl(
      reference,
      SIGNED_URL_TTL_SECONDS,
    );
    return {
      signed_url: signedUrl,
      expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }
}
