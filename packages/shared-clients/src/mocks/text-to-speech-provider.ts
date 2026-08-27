import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  ProviderHealth,
  ProviderMetadata,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
  TextToSpeechProvider,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_TEXT_TO_SPEECH_CAPABILITIES: ProviderCapabilities = {
  ...mockCapabilities(5_242_880),
  batch_support: false,
};

export interface MockTextToSpeechProvider extends TextToSpeechProvider {
  getRequests(): readonly SpeechSynthesisRequest[];
}

export interface MockTextToSpeechProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"TextToSpeechProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly health?: ProviderHealth;
  readonly synthesizeSpeech?: (
    request: SpeechSynthesisRequest,
  ) => Promise<SpeechSynthesisResult>;
}

function defaultSynthesizeSpeech(
  providerId: string,
  request: SpeechSynthesisRequest,
): SpeechSynthesisResult {
  return {
    reference: `mock-speech://${providerId}/${encodeURIComponent(request.text).slice(0, 64)}`,
    mimeType: "audio/mpeg",
    // Deterministic stand-in for real synthesis timing: proportional to
    // text length, floored so even an empty string still yields a sane clip.
    durationMs: 200 + request.text.length * 50,
  };
}

export function createMockTextToSpeechProvider(
  options: MockTextToSpeechProviderOptions = {},
): MockTextToSpeechProvider {
  const providerId = options.providerId ?? "mock.text-to-speech";
  const requests: SpeechSynthesisRequest[] = [];
  const synthesizeSpeech =
    options.synthesizeSpeech ??
    (async (request) => defaultSynthesizeSpeech(providerId, request));

  return createMockProvider<MockTextToSpeechProvider>({
    metadata:
      options.metadata ?? mockMetadata(providerId, "TextToSpeechProvider"),
    capabilities: options.capabilities ?? MOCK_TEXT_TO_SPEECH_CAPABILITIES,
    ...(options.health === undefined ? {} : { health: options.health }),
    implementation: {
      synthesizeSpeech: async (request) => {
        requests.push({ ...request });
        return synthesizeSpeech(request);
      },
      getRequests: () => requests.map((request) => ({ ...request })),
    },
  });
}
