import { z } from "zod";
import { MediaHttpError } from "./problem";
import type { GenerateImageInput, SynthesizeSpeechInput, TranscribeInput } from "./types";

// ImageGenerationRequest.options / SpeechSynthesisRequest.voiceConfig are
// typed as Readonly<Record<string, JsonValue>> (packages/shared-clients/
// src/provider-types.ts), which technically allows nested JSON. Every
// real field either real adapter actually reads today (width/height/
// cfgScale/seed/quality/negativeText/numberOfImages for Titan;
// voiceId/engine/textType for Polly) is a flat primitive, so validation
// stays at that flat shape rather than a fully recursive JSON schema for
// values nothing currently uses.
const jsonPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const optionsBagSchema = z.record(z.string(), jsonPrimitive);

const generateImageSchema = z.object({
  prompt: z.string().trim().min(1).max(2_000),
  options: optionsBagSchema.optional(),
});

const synthesizeSpeechSchema = z.object({
  text: z.string().trim().min(1).max(6_000),
  voice_config: optionsBagSchema.optional(),
});

const transcribeSchema = z.object({
  audio_ref: z.string().trim().min(1).max(2_048),
});

export function parseGenerateImageInput(value: unknown, instance: string): GenerateImageInput {
  const parsed = parse(generateImageSchema, value, instance);
  return { prompt: parsed.prompt, options: parsed.options ?? {} };
}

export function parseSynthesizeSpeechInput(value: unknown, instance: string): SynthesizeSpeechInput {
  const parsed = parse(synthesizeSpeechSchema, value, instance);
  return { text: parsed.text, voiceConfig: parsed.voice_config ?? {} };
}

export function parseTranscribeInput(value: unknown, instance: string): TranscribeInput {
  const parsed = parse(transcribeSchema, value, instance);
  return { audioRef: parsed.audio_ref };
}

function parse<T extends z.ZodType>(schema: T, value: unknown, instance: string): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new MediaHttpError(400, "MEDIA_INPUT_INVALID", "Media request input is invalid", instance);
}
