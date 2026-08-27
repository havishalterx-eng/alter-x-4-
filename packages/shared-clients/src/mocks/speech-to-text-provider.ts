import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  ProviderHealth,
  ProviderMetadata,
  SpeechToTextProvider,
  SpeechTranscriptionRequest,
  SpeechTranscriptionResult,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_SPEECH_TO_TEXT_CAPABILITIES: ProviderCapabilities = {
  ...mockCapabilities(26_214_400),
  batch_support: false,
};

export interface MockSpeechToTextProvider extends SpeechToTextProvider {
  getRequests(): readonly SpeechTranscriptionRequest[];
}

export interface MockSpeechToTextProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"SpeechToTextProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly health?: ProviderHealth;
  readonly transcribe?: (
    request: SpeechTranscriptionRequest,
  ) => Promise<SpeechTranscriptionResult>;
}

function defaultTranscribe(
  request: SpeechTranscriptionRequest,
): SpeechTranscriptionResult {
  return {
    transcript: `Mock transcript for ${request.audioRef}`,
    confidence: 0.92,
  };
}

export function createMockSpeechToTextProvider(
  options: MockSpeechToTextProviderOptions = {},
): MockSpeechToTextProvider {
  const providerId = options.providerId ?? "mock.speech-to-text";
  const requests: SpeechTranscriptionRequest[] = [];
  const transcribe =
    options.transcribe ?? (async (request) => defaultTranscribe(request));

  return createMockProvider<MockSpeechToTextProvider>({
    metadata:
      options.metadata ?? mockMetadata(providerId, "SpeechToTextProvider"),
    capabilities: options.capabilities ?? MOCK_SPEECH_TO_TEXT_CAPABILITIES,
    ...(options.health === undefined ? {} : { health: options.health }),
    implementation: {
      transcribe: async (request) => {
        requests.push({ ...request });
        return transcribe(request);
      },
      getRequests: () => requests.map((request) => ({ ...request })),
    },
  });
}
