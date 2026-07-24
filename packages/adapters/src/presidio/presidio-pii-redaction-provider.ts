import type { ProviderCapabilities } from "@alterx/contracts";
import {
  INDIAN_PII_RECOGNIZER_PATTERNS,
  validateRecognizedEntity,
  type PIIDetectedEntity,
  type PIIRedactionProvider,
  type PIIRedactionRequest,
  type PIIRedactionResult,
  type ProviderHealth,
  type ProviderMetadata,
} from "@alterx/shared-clients";

export interface PresidioPIIRedactionProviderConfig {
  readonly analyzerBaseUrl: string;
  readonly anonymizerBaseUrl: string;
}

export interface PresidioHttpClient {
  postJson(url: string, body: unknown): Promise<unknown>;
}

export function createFetchPresidioHttpClient(): PresidioHttpClient {
  return {
    async postJson(url: string, body: unknown): Promise<unknown> {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `Presidio request to ${url} failed with status ${response.status}`,
        );
      }
      return response.json();
    },
  };
}

export const PRESIDIO_PII_REDACTION_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 50_000,
  supported_languages: ["en"],
  cost_model: { rates: [] },
};

const PRESIDIO_PII_REDACTION_METADATA: ProviderMetadata<"PIIRedactionProvider"> =
  {
    providerId: "presidio-pii-redaction",
    interfaceName: "PIIRedactionProvider",
    displayName: "Microsoft Presidio PII Redaction",
    version: "gateways-v1",
    telemetryNamespace: "alterx.adapters.presidio.pii_redaction",
    supportsTenantOverrides: false,
    migration: {
      strategyVersion: "presidio-analyzer-anonymizer-v1",
      rollbackSupported: true,
    },
  };

interface PresidioAnalyzeEntity {
  readonly entity_type?: unknown;
  readonly start?: unknown;
  readonly end?: unknown;
  readonly score?: unknown;
}

interface PresidioAnonymizeResponse {
  readonly text?: unknown;
}

function buildAdHocRecognizers(): readonly Record<string, unknown>[] {
  return INDIAN_PII_RECOGNIZER_PATTERNS.map((pattern) => ({
    name: `${pattern.name}_recognizer`,
    supported_language: "en",
    supported_entity: pattern.entityType,
    patterns: [
      {
        name: pattern.name,
        regex: pattern.regex,
        score: pattern.score,
      },
    ],
  }));
}

function parseAnalyzeResponse(raw: unknown): PIIDetectedEntity[] {
  if (!Array.isArray(raw)) {
    throw new Error("Presidio analyze response must be an array");
  }
  const entities: PIIDetectedEntity[] = [];
  for (const item of raw as PresidioAnalyzeEntity[]) {
    if (
      typeof item.entity_type !== "string" ||
      typeof item.start !== "number" ||
      typeof item.end !== "number" ||
      typeof item.score !== "number"
    ) {
      throw new Error(
        "Presidio analyze response entry is missing entity_type, start, end, or score",
      );
    }
    entities.push({
      entityType: item.entity_type,
      start: item.start,
      end: item.end,
      score: item.score,
    });
  }
  return entities;
}

function parseAnonymizeResponse(raw: unknown): string {
  const response = raw as PresidioAnonymizeResponse;
  if (typeof response.text !== "string") {
    throw new Error("Presidio anonymize response is missing text");
  }
  return response.text;
}

function validateRequest(request: PIIRedactionRequest): void {
  if (request.tenantId.trim().length === 0) {
    throw new Error("PII redaction tenantId is required");
  }
}

export class PresidioPIIRedactionProvider implements PIIRedactionProvider {
  readonly metadata = PRESIDIO_PII_REDACTION_METADATA;
  readonly capabilities = PRESIDIO_PII_REDACTION_CAPABILITIES;

  readonly #config: PresidioPIIRedactionProviderConfig;
  readonly #client: PresidioHttpClient;
  readonly #now: () => Date;

  constructor(
    config: PresidioPIIRedactionProviderConfig,
    client?: PresidioHttpClient,
    now?: () => Date,
  ) {
    if (config.analyzerBaseUrl.trim().length === 0) {
      throw new Error("Presidio analyzer base URL is required");
    }
    if (config.anonymizerBaseUrl.trim().length === 0) {
      throw new Error("Presidio anonymizer base URL is required");
    }
    this.#config = config;
    this.#client = client ?? createFetchPresidioHttpClient();
    this.#now = now ?? (() => new Date());
  }

  async redact(request: PIIRedactionRequest): Promise<PIIRedactionResult> {
    validateRequest(request);

    if (request.text.trim().length === 0) {
      return { redactedText: request.text, entities: [] };
    }

    const analyzeRaw = await this.#client.postJson(
      `${this.#config.analyzerBaseUrl}/analyze`,
      {
        text: request.text,
        language: "en",
        ad_hoc_recognizers: buildAdHocRecognizers(),
      },
    );
    const detected = parseAnalyzeResponse(analyzeRaw);
    const validated = detected.filter((entity) =>
      validateRecognizedEntity(
        entity.entityType,
        request.text.slice(entity.start, entity.end),
      ),
    );

    if (validated.length === 0) {
      return { redactedText: request.text, entities: [] };
    }

    const anonymizeRaw = await this.#client.postJson(
      `${this.#config.anonymizerBaseUrl}/anonymize`,
      {
        text: request.text,
        analyzer_results: validated.map((entity) => ({
          entity_type: entity.entityType,
          start: entity.start,
          end: entity.end,
          score: entity.score,
        })),
      },
    );

    return {
      redactedText: parseAnonymizeResponse(anonymizeRaw),
      entities: Object.freeze(validated),
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: "healthy",
      checkedAt: this.#now().toISOString(),
      latencyMs: 0,
      details: {
        configured: true,
        liveProbe: false,
      },
    };
  }
}
