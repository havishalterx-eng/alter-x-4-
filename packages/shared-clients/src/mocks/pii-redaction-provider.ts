import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import {
  INDIAN_PII_RECOGNIZER_PATTERNS,
  validateRecognizedEntity,
} from "../pii-recognizers";
import type {
  PIIDetectedEntity,
  PIIRedactionProvider,
  PIIRedactionRequest,
  PIIRedactionResult,
  ProviderHealth,
  ProviderMetadata,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_PII_REDACTION_CAPABILITIES: ProviderCapabilities = {
  ...mockCapabilities(50_000),
  batch_support: false,
};

export interface MockPIIRedactionProvider extends PIIRedactionProvider {
  getRequests(): readonly PIIRedactionRequest[];
}

export interface MockPIIRedactionProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"PIIRedactionProvider">;
  readonly capabilities?: ProviderCapabilities;
  readonly health?: ProviderHealth;
  readonly redact?: (
    request: PIIRedactionRequest,
  ) => Promise<PIIRedactionResult>;
}

function detectEntities(text: string): PIIDetectedEntity[] {
  const entities: PIIDetectedEntity[] = [];
  for (const pattern of INDIAN_PII_RECOGNIZER_PATTERNS) {
    const matcher = new RegExp(pattern.regex, "g");
    for (const match of text.matchAll(matcher)) {
      if (
        match.index === undefined ||
        !validateRecognizedEntity(pattern.entityType, match[0])
      ) {
        continue;
      }
      entities.push({
        entityType: pattern.entityType,
        start: match.index,
        end: match.index + match[0].length,
        score: pattern.score,
      });
    }
  }
  // Later start wins ties so replacement can walk left-to-right without
  // re-scanning already-consumed spans when two patterns overlap.
  return entities.sort((a, b) => a.start - b.start || a.end - b.end);
}

function applyRedaction(
  text: string,
  entities: readonly PIIDetectedEntity[],
): string {
  let redactedText = "";
  let cursor = 0;
  for (const entity of entities) {
    if (entity.start < cursor) {
      continue;
    }
    redactedText += text.slice(cursor, entity.start);
    redactedText += `<${entity.entityType}>`;
    cursor = entity.end;
  }
  redactedText += text.slice(cursor);
  return redactedText;
}

function defaultRedact(request: PIIRedactionRequest): PIIRedactionResult {
  const entities = detectEntities(request.text);
  return {
    redactedText: applyRedaction(request.text, entities),
    entities: Object.freeze(entities),
  };
}

export function createMockPIIRedactionProvider(
  options: MockPIIRedactionProviderOptions = {},
): MockPIIRedactionProvider {
  const providerId = options.providerId ?? "mock.pii-redaction";
  const requests: PIIRedactionRequest[] = [];
  const redact = options.redact ?? (async (request) => defaultRedact(request));

  return createMockProvider<MockPIIRedactionProvider>({
    metadata:
      options.metadata ?? mockMetadata(providerId, "PIIRedactionProvider"),
    capabilities: options.capabilities ?? MOCK_PII_REDACTION_CAPABILITIES,
    ...(options.health === undefined ? {} : { health: options.health }),
    implementation: {
      redact: async (request) => {
        requests.push({ ...request });
        return redact(request);
      },
      getRequests: () => requests.map((request) => ({ ...request })),
    },
  });
}
