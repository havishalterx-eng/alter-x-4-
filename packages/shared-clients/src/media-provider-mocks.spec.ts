import { describe, expect, it } from "vitest";
import { assertProviderContractParity } from "./contract-testing";
import { createMockImageGenProvider } from "./mocks/image-gen-provider";
import { createMockSpeechToTextProvider } from "./mocks/speech-to-text-provider";
import { createMockTextToSpeechProvider } from "./mocks/text-to-speech-provider";
import {
  imageGenProviderContract,
  speechToTextProviderContract,
  textToSpeechProviderContract,
} from "./provider-contracts";

// No real adapter exists yet for any of these three interfaces (stage 1 of
// ENG-MEDIA.md's build-out lands adapters later). Contract parity is
// asserted between two independently constructed mock instances instead of
// mock-vs-real: each mock's default behavior is a pure function of its
// request, so two fresh instances given the same call sequence produce
// identical results -- this still exercises every real assertion in the
// contract suite (workflow-attached call and standalone call alike), it
// just has no second real implementation to compare against yet.

describe("ImageGenProvider mock", () => {
  it("satisfies the image-gen provider contract with parity against itself", async () => {
    const report = await assertProviderContractParity(imageGenProviderContract, [
      { name: "image-gen-mock-a", create: async () => createMockImageGenProvider() },
      { name: "image-gen-mock-b", create: async () => createMockImageGenProvider() },
    ]);
    expect(report.passed).toBe(true);
  });

  it("records every request it receives", async () => {
    const provider = createMockImageGenProvider();
    await provider.generateImage({
      tenantId: "ten_a",
      prompt: "a red bicycle",
      options: {},
    });
    expect(provider.getRequests()).toEqual([
      { tenantId: "ten_a", prompt: "a red bicycle", options: {} },
    ]);
  });
});

describe("TextToSpeechProvider mock", () => {
  it("satisfies the text-to-speech provider contract with parity against itself", async () => {
    const report = await assertProviderContractParity(
      textToSpeechProviderContract,
      [
        {
          name: "text-to-speech-mock-a",
          create: async () => createMockTextToSpeechProvider(),
        },
        {
          name: "text-to-speech-mock-b",
          create: async () => createMockTextToSpeechProvider(),
        },
      ],
    );
    expect(report.passed).toBe(true);
  });

  it("records every request it receives", async () => {
    const provider = createMockTextToSpeechProvider();
    await provider.synthesizeSpeech({
      tenantId: "ten_a",
      text: "hello there",
      voiceConfig: {},
    });
    expect(provider.getRequests()).toEqual([
      { tenantId: "ten_a", text: "hello there", voiceConfig: {} },
    ]);
  });
});

describe("SpeechToTextProvider mock", () => {
  it("satisfies the speech-to-text provider contract with parity against itself", async () => {
    const report = await assertProviderContractParity(
      speechToTextProviderContract,
      [
        {
          name: "speech-to-text-mock-a",
          create: async () => createMockSpeechToTextProvider(),
        },
        {
          name: "speech-to-text-mock-b",
          create: async () => createMockSpeechToTextProvider(),
        },
      ],
    );
    expect(report.passed).toBe(true);
  });

  it("records every request it receives", async () => {
    const provider = createMockSpeechToTextProvider();
    await provider.transcribe({
      tenantId: "ten_a",
      audioRef: "s3://bucket/clip.wav",
    });
    expect(provider.getRequests()).toEqual([
      { tenantId: "ten_a", audioRef: "s3://bucket/clip.wav" },
    ]);
  });
});
