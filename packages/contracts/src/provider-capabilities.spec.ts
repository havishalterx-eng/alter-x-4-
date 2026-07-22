import { describe, expect, it } from "vitest";
import { ProviderCapabilitiesSchema } from "./provider-capabilities";

const validCapabilities = {
  streaming: true,
  tool_calling: true,
  vision: false,
  structured_output: true,
  long_context: true,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: true,
  maximum_payload: 1_048_576,
  supported_languages: ["en", "hi"],
  cost_model: {
    rates: [
      {
        unit: "input_token",
        currency_code: "USD",
        amount: 0.000_001,
      },
    ],
  },
};

describe("ProviderCapabilitiesSchema", () => {
  it("contains exactly the 11 capability registry keys", () => {
    expect(Object.keys(ProviderCapabilitiesSchema.shape)).toEqual([
      "streaming",
      "tool_calling",
      "vision",
      "structured_output",
      "long_context",
      "regional_availability",
      "data_residency",
      "batch_support",
      "maximum_payload",
      "supported_languages",
      "cost_model",
    ]);
  });

  it("accepts all required capability keys", () => {
    expect(
      ProviderCapabilitiesSchema.parse(validCapabilities),
    ).toEqual(validCapabilities);
  });

  it("rejects a missing capability key", () => {
    const withoutStreaming = { ...validCapabilities, streaming: undefined };
    expect(
      ProviderCapabilitiesSchema.safeParse(withoutStreaming).success,
    ).toBe(false);
  });

  it("rejects non-positive maximum payloads", () => {
    expect(
      ProviderCapabilitiesSchema.safeParse({
        ...validCapabilities,
        maximum_payload: 0,
      }).success,
    ).toBe(false);
  });
});
