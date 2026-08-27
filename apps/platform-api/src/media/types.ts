import type { JsonValue } from "@alterx/shared-clients";

export interface GenerateImageInput {
  readonly prompt: string;
  readonly options: Readonly<Record<string, JsonValue>>;
}

export interface SynthesizeSpeechInput {
  readonly text: string;
  readonly voiceConfig: Readonly<Record<string, JsonValue>>;
}

export interface TranscribeInput {
  readonly audioRef: string;
}

// Vendor-neutral, output-shaped fields only (signed_url/mime_type/etc) --
// never a field a client would need to branch on by vendor name
// (ENG-MEDIA.md's own audit checklist: "no vendor name in any route path
// or response contract").
export interface SignedMediaResult {
  readonly signed_url: string;
  readonly expires_at: string;
  readonly mime_type: string;
}

export interface GeneratedImageResult extends SignedMediaResult {
  readonly width: number;
  readonly height: number;
}

export interface SynthesizedSpeechResult extends SignedMediaResult {
  readonly duration_ms: number;
}

export interface TranscriptionResult {
  readonly transcript: string;
  readonly confidence: number;
}
