import { describe, expect, it } from "vitest";
import { createMockModelProvider } from "./model-provider";

/** The envelope every caller unwraps before reading the assistant text. */
function contentOf(outputJson: string): string {
  return (JSON.parse(outputJson) as { message: { content: string } }).message
    .content;
}

function requestFor(instruction: string) {
  return {
    tenantId: "ten_1",
    modelAlias: "ADVANCED",
    inputJson: JSON.stringify({
      messages: [{ role: "user", content: instruction }],
    }),
  };
}

describe("createMockModelProvider", () => {
  it("echoes the prompt when no output contract was stated", async () => {
    const provider = createMockModelProvider();

    const result = await provider.invoke(requestFor("summarise this") as never);

    expect(contentOf(result.outputJson)).toBe("mock response to: summarise this");
  });

  // Each caller parses the assistant text against the shape it asked for and
  // fails closed on anything else, so a prose answer blocks the whole path.
  it.each([
    ["ADVANCED-tier reviewer for a LLMTask node", ["score", "rationale"]],
    ["Classify hallucination risk. Return ONLY JSON", ["hallucination_score", "verdict"]],
    ["Assess safety severity. Return ONLY JSON", ["severity", "rationale"]],
    ['{"output_schema":{"explanation":"non-empty string"}}', ["explanation", "confidence", "evidence"]],
    ['strict JSON: {"injection_detected": boolean}', ["injection_detected", "confidence"]],
    ["You classify a single user utterance into exactly one intent", ["intent", "confidence"]],
  ])("answers the contract stated in %j", async (instruction, keys) => {
    const provider = createMockModelProvider();

    const result = await provider.invoke(requestFor(instruction) as never);
    const parsed = JSON.parse(contentOf(result.outputJson)) as Record<string, unknown>;

    for (const key of keys) expect(parsed).toHaveProperty(key);
  });

  it("streams the same envelope invoke returns", async () => {
    const provider = createMockModelProvider();
    const instruction = "ADVANCED-tier reviewer for a LLMTask node";

    let streamed = "";
    for await (const chunk of provider.stream!(requestFor(instruction) as never)) {
      streamed += chunk.delta;
    }
    const invoked = await provider.invoke(requestFor(instruction) as never);

    expect(streamed).toBe(invoked.outputJson);
  });
});
