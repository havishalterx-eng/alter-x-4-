import {
  assertProviderContractParity,
  createMockPIIRedactionProvider,
  piiRedactionProviderContract,
  type PIIRedactionProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  PRESIDIO_PII_REDACTION_CAPABILITIES,
  PresidioPIIRedactionProvider,
  type PresidioHttpClient,
} from "./presidio-pii-redaction-provider";

const FIXED_CHECKED_AT = "2026-07-24T00:00:00.000Z";
const VALID_AADHAAR = "234567890124";
const INVALID_CHECKSUM_AADHAAR = "234567890125";

function fakeClient(
  handler: (url: string, body: unknown) => Promise<unknown>,
): PresidioHttpClient {
  return { postJson: vi.fn(handler) };
}

function analyzeEntity(entityType: string, start: number, end: number) {
  return { entity_type: entityType, start, end, score: 0.85 };
}

function realProvider(): PIIRedactionProvider {
  const client = fakeClient(async (url, body) => {
    if (url.endsWith("/analyze")) {
      const { text } = body as { text: string };
      if (text.includes("ABCDE1234F")) {
        const start = text.indexOf("ABCDE1234F");
        return [analyzeEntity("IN_PAN", start, start + "ABCDE1234F".length)];
      }
      return [];
    }
    const { text, analyzer_results: entities } = body as {
      text: string;
      analyzer_results: { entity_type: string; start: number; end: number }[];
    };
    let redacted = text;
    for (const entity of [...entities].sort((a, b) => b.start - a.start)) {
      redacted =
        redacted.slice(0, entity.start) +
        `<${entity.entity_type}>` +
        redacted.slice(entity.end);
    }
    return { text: redacted };
  });
  return new PresidioPIIRedactionProvider(
    {
      analyzerBaseUrl: "http://presidio-analyzer.local",
      anonymizerBaseUrl: "http://presidio-anonymizer.local",
    },
    client,
    () => new Date(FIXED_CHECKED_AT),
  );
}

function equivalentMockProvider(): PIIRedactionProvider {
  return createMockPIIRedactionProvider({
    capabilities: PRESIDIO_PII_REDACTION_CAPABILITIES,
    health: {
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: { configured: true, liveProbe: false },
    },
  });
}

describe("PresidioPIIRedactionProvider", () => {
  it("sends the custom Indian recognizers as ad_hoc_recognizers on /analyze", async () => {
    const postJson = vi.fn(async (url: string, body: unknown) => {
      if (url.endsWith("/analyze")) {
        const { ad_hoc_recognizers: recognizers } = body as {
          ad_hoc_recognizers: { supported_entity: string }[];
        };
        expect(recognizers.map((r) => r.supported_entity)).toEqual([
          "IN_AADHAAR",
          "IN_PAN",
          "IN_GSTIN",
          "IN_PHONE_NUMBER",
          "IN_BANK_IFSC",
        ]);
        return [];
      }
      throw new Error("anonymize should not be called with zero entities");
    });
    const provider = new PresidioPIIRedactionProvider(
      {
        analyzerBaseUrl: "http://presidio-analyzer.local",
        anonymizerBaseUrl: "http://presidio-anonymizer.local",
      },
      { postJson },
    );

    const result = await provider.redact({
      tenantId: "tenant-1",
      text: "no PII here",
    });

    expect(result).toEqual({ redactedText: "no PII here", entities: [] });
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it("redacts a detected PAN via analyzer + anonymizer round trip", async () => {
    const text = "PAN on file: ABCDE1234F";
    const start = text.indexOf("ABCDE1234F");
    const postJson = vi.fn(async (url: string, body: unknown) => {
      if (url.endsWith("/analyze")) {
        return [analyzeEntity("IN_PAN", start, start + 10)];
      }
      const { analyzer_results: entities } = body as {
        analyzer_results: { entity_type: string }[];
      };
      expect(entities).toEqual([
        { entity_type: "IN_PAN", start, end: start + 10, score: 0.85 },
      ]);
      return { text: "PAN on file: <IN_PAN>" };
    });
    const provider = new PresidioPIIRedactionProvider(
      {
        analyzerBaseUrl: "http://presidio-analyzer.local",
        anonymizerBaseUrl: "http://presidio-anonymizer.local",
      },
      { postJson },
    );

    const result = await provider.redact({ tenantId: "tenant-1", text });

    expect(result.redactedText).toBe("PAN on file: <IN_PAN>");
    expect(result.entities).toEqual([
      { entityType: "IN_PAN", start, end: start + 10, score: 0.85 },
    ]);
  });

  it("drops an Aadhaar-shaped match that fails the Verhoeff checksum before calling anonymize", async () => {
    const text = `Aadhaar: ${INVALID_CHECKSUM_AADHAAR}`;
    const start = text.indexOf(INVALID_CHECKSUM_AADHAAR);
    const postJson = vi.fn(async (url: string) => {
      if (url.endsWith("/analyze")) {
        return [
          analyzeEntity(
            "IN_AADHAAR",
            start,
            start + INVALID_CHECKSUM_AADHAAR.length,
          ),
        ];
      }
      throw new Error("anonymize must not be called once checksum fails");
    });
    const provider = new PresidioPIIRedactionProvider(
      {
        analyzerBaseUrl: "http://presidio-analyzer.local",
        anonymizerBaseUrl: "http://presidio-anonymizer.local",
      },
      { postJson },
    );

    const result = await provider.redact({ tenantId: "tenant-1", text });

    expect(result).toEqual({ redactedText: text, entities: [] });
  });

  it("keeps an Aadhaar match that passes the Verhoeff checksum", async () => {
    const text = `Aadhaar: ${VALID_AADHAAR}`;
    const start = text.indexOf(VALID_AADHAAR);
    const postJson = vi.fn(async (url: string) => {
      if (url.endsWith("/analyze")) {
        return [analyzeEntity("IN_AADHAAR", start, start + VALID_AADHAAR.length)];
      }
      return { text: "Aadhaar: <IN_AADHAAR>" };
    });
    const provider = new PresidioPIIRedactionProvider(
      {
        analyzerBaseUrl: "http://presidio-analyzer.local",
        anonymizerBaseUrl: "http://presidio-anonymizer.local",
      },
      { postJson },
    );

    const result = await provider.redact({ tenantId: "tenant-1", text });

    expect(result.redactedText).toBe("Aadhaar: <IN_AADHAAR>");
    expect(result.entities).toHaveLength(1);
  });

  it("short-circuits on empty text without calling Presidio", async () => {
    const postJson = vi.fn();
    const provider = new PresidioPIIRedactionProvider(
      {
        analyzerBaseUrl: "http://presidio-analyzer.local",
        anonymizerBaseUrl: "http://presidio-anonymizer.local",
      },
      { postJson },
    );

    await expect(
      provider.redact({ tenantId: "tenant-1", text: "" }),
    ).resolves.toEqual({ redactedText: "", entities: [] });
    expect(postJson).not.toHaveBeenCalled();
  });

  it("rejects an empty tenantId", async () => {
    const provider = new PresidioPIIRedactionProvider(
      {
        analyzerBaseUrl: "http://presidio-analyzer.local",
        anonymizerBaseUrl: "http://presidio-anonymizer.local",
      },
      { postJson: vi.fn() },
    );

    await expect(
      provider.redact({ tenantId: "", text: "x" }),
    ).rejects.toThrow(/tenantId/);
  });

  it("validates required config at construction", () => {
    expect(
      () =>
        new PresidioPIIRedactionProvider({
          analyzerBaseUrl: "",
          anonymizerBaseUrl: "http://presidio-anonymizer.local",
        }),
    ).toThrow(/analyzer base URL/);
    expect(
      () =>
        new PresidioPIIRedactionProvider({
          analyzerBaseUrl: "http://presidio-analyzer.local",
          anonymizerBaseUrl: "",
        }),
    ).toThrow(/anonymizer base URL/);
  });

  it("reports configured health without making a live Presidio call", async () => {
    const postJson = vi.fn();
    const provider = new PresidioPIIRedactionProvider(
      {
        analyzerBaseUrl: "http://presidio-analyzer.local",
        anonymizerBaseUrl: "http://presidio-anonymizer.local",
      },
      { postJson },
      () => new Date(FIXED_CHECKED_AT),
    );

    await expect(provider.healthCheck()).resolves.toEqual({
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: { configured: true, liveProbe: false },
    });
    expect(postJson).not.toHaveBeenCalled();
  });
});

describe("PIIRedactionProvider contract", () => {
  it("passes the unmodified shared contract suite with the real Presidio adapter", async () => {
    const report = await assertProviderContractParity(
      piiRedactionProviderContract,
      [
        { name: "presidio-primary", create: realProvider },
        { name: "presidio-parity", create: realProvider },
      ],
    );

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });

  it("passes the unmodified shared contract suite across the real adapter and the mock", async () => {
    const report = await assertProviderContractParity(
      piiRedactionProviderContract,
      [
        { name: "presidio-real", create: realProvider },
        { name: "presidio-mock", create: equivalentMockProvider },
      ],
    );

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });
});
