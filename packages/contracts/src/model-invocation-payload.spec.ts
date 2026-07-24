import { describe, expect, it } from "vitest";
import {
  ModelInvocationPayloadSchema,
  ModelInvocationResultPayloadSchema,
  ModelInvocationUsageSchema,
} from "./model-invocation-payload";

describe("ModelInvocationPayloadSchema", () => {
  it("accepts a minimal single-message payload", () => {
    const payload = { messages: [{ role: "user", content: "hello" }] };
    expect(ModelInvocationPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("accepts system, user, and assistant roles with optional inference params", () => {
    const payload = {
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      max_tokens: 512,
      temperature: 0.5,
    };
    expect(ModelInvocationPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("rejects an empty messages array", () => {
    expect(
      ModelInvocationPayloadSchema.safeParse({ messages: [] }).success,
    ).toBe(false);
  });

  it("rejects an unrecognized role", () => {
    expect(
      ModelInvocationPayloadSchema.safeParse({
        messages: [{ role: "tool", content: "x" }],
      }).success,
    ).toBe(false);
  });

  it("rejects temperature outside 0-1", () => {
    expect(
      ModelInvocationPayloadSchema.safeParse({
        messages: [{ role: "user", content: "x" }],
        temperature: 1.5,
      }).success,
    ).toBe(false);
  });
});

describe("ModelInvocationResultPayloadSchema", () => {
  it("accepts an assistant response with a stop reason", () => {
    const result = {
      message: { role: "assistant", content: "hi there" },
      stop_reason: "end_turn",
    };
    expect(ModelInvocationResultPayloadSchema.parse(result)).toEqual(result);
  });

  it("rejects a non-assistant role", () => {
    expect(
      ModelInvocationResultPayloadSchema.safeParse({
        message: { role: "user", content: "hi" },
        stop_reason: "end_turn",
      }).success,
    ).toBe(false);
  });
});

describe("ModelInvocationUsageSchema", () => {
  it("accepts non-negative token counts", () => {
    const usage = { input_tokens: 10, output_tokens: 20 };
    expect(ModelInvocationUsageSchema.parse(usage)).toEqual(usage);
  });

  it("rejects negative token counts", () => {
    expect(
      ModelInvocationUsageSchema.safeParse({
        input_tokens: -1,
        output_tokens: 0,
      }).success,
    ).toBe(false);
  });
});
