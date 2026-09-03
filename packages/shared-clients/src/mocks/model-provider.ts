import {
  ModelInvocationPayloadSchema,
  type ProviderCapabilities,
} from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelInvocationStreamChunk,
  ModelProvider,
  ProviderHealth,
  ProviderMetadata,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_MODEL_CAPABILITIES: ProviderCapabilities = {
  ...mockCapabilities(1_048_576),
  streaming: true,
  structured_output: true,
};

export interface MockModelProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"ModelProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly health?: ProviderHealth;
  readonly invoke?: (
    request: ModelInvocationRequest,
  ) => Promise<ModelInvocationResult>;
  readonly stream?: (
    request: ModelInvocationRequest,
  ) => AsyncIterable<ModelInvocationStreamChunk>;
}

/**
 * Callers that ask this provider for a specific JSON shape parse the reply
 * against that shape and fail closed when it does not match, so a mock that
 * always answers in prose blocks them all. Verification cannot score a node,
 * recovery cannot estimate a root cause, and a local run stops at the first
 * gate that needs an opinion from a model.
 *
 * Each entry below is matched against the request's own instruction text and
 * mirrors a contract that a caller states in its prompt. The verdicts are
 * deliberately benign -- a passing score, no hallucination, low severity, no
 * injection -- so a run proceeds far enough to exercise the path.
 *
 * The ceiling: these are fixed answers keyed off the prompt, not a model. A
 * test that needs a specific verdict should inject its own `invoke` through
 * MockModelProviderOptions rather than adding a branch here, and anything
 * asserting real model judgement belongs against a real provider.
 */
const STRUCTURED_REPLIES: readonly {
  readonly matches: RegExp;
  readonly reply: Readonly<Record<string, unknown>>;
}[] = [
  {
    // verification-service, ADVANCED reviewer: {"score", "rationale"}
    matches: /ADVANCED-tier reviewer/,
    reply: { score: 0.9, rationale: "mock reviewer: output satisfies the rubric" },
  },
  {
    // verification-service, hallucination assessor
    matches: /Classify hallucination risk/,
    reply: {
      hallucination_score: 0.05,
      verdict: "pass",
      flagged_spans: [],
      reasons: ["mock assessor: every claim is supported by the evidence"],
    },
  },
  {
    // verification-service, safety severity assessor
    matches: /Assess safety severity/,
    reply: { severity: "low", rationale: "mock assessor: no unsafe content" },
  },
  {
    // orchestration recovery, ADVANCED root-cause estimator. It states its
    // contract as an output_schema field rather than in prose.
    matches: /"output_schema"[\s\S]*"explanation"/,
    reply: {
      explanation: "mock estimator: the node failed on a transient dependency error",
      confidence: 0.5,
      evidence: ["mock estimator: derived from the deterministic classification"],
    },
  },
  {
    // session-gateway prompt-injection classifier
    matches: /injection_detected/,
    reply: {
      injection_detected: false,
      confidence: 0.02,
      reason: "mock classifier: no attempt to override instructions",
    },
  },
  {
    // orchestration conversation manager, intent classification
    matches: /classify a single user utterance/i,
    reply: { intent: "answer", confidence: 0.9 },
  },
];

/** The assistant text for a request: a contract-shaped reply when the caller
 * asked for one, otherwise the prose echo. */
function mockAssistantContent(
  messages: readonly { readonly content: string }[],
): string {
  const instruction = messages.map((message) => message.content).join("\n");
  const structured = STRUCTURED_REPLIES.find(({ matches }) =>
    matches.test(instruction),
  );
  if (structured !== undefined) return JSON.stringify(structured.reply);
  return `mock response to: ${messages[messages.length - 1]?.content ?? ""}`;
}

function defaultStream(
  providerId: string,
): (request: ModelInvocationRequest) => AsyncIterable<ModelInvocationStreamChunk> {
  return async function* (request) {
    const payload = ModelInvocationPayloadSchema.parse(
      JSON.parse(request.inputJson),
    );
    // Consumers concatenate the deltas and parse the result as the node's
    // output_json, so the stream has to spell out the same JSON envelope the
    // invoke path returns. Emitting bare prose here made every streamed node
    // fail with "output_json is not valid JSON".
    yield {
      sequence: 1,
      delta: JSON.stringify({
        message: {
          role: "assistant",
          content: mockAssistantContent(payload.messages),
        },
        stop_reason: "end_turn",
      }),
      final: false,
      servedBy: providerId,
    };
    yield {
      sequence: 2,
      delta: "",
      final: true,
      usageJson: JSON.stringify({ input_tokens: 0, output_tokens: 0 }),
      servedBy: providerId,
    };
  };
}

function defaultInvoke(
  providerId: string,
): (request: ModelInvocationRequest) => Promise<ModelInvocationResult> {
  return async (request) => {
    const payload = ModelInvocationPayloadSchema.parse(
      JSON.parse(request.inputJson),
    );
    return {
      outputJson: JSON.stringify({
        message: {
          role: "assistant",
          content: mockAssistantContent(payload.messages),
        },
        stop_reason: "end_turn",
      }),
      usageJson: JSON.stringify({ input_tokens: 0, output_tokens: 0 }),
      servedBy: providerId,
    };
  };
}

export function createMockModelProvider(
  options: MockModelProviderOptions = {},
): ModelProvider {
  const providerId = options.providerId ?? "mock.model";

  return createMockProvider<ModelProvider>({
    metadata: options.metadata ?? mockMetadata(providerId, "ModelProvider"),
    capabilities: options.capabilities ?? MOCK_MODEL_CAPABILITIES,
    ...(options.health === undefined ? {} : { health: options.health }),
    implementation: {
      invoke: options.invoke ?? defaultInvoke(providerId),
      stream: options.stream ?? defaultStream(providerId),
    },
  });
}
