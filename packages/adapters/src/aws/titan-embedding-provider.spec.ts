import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  assertProviderContractParity,
  createMockEmbeddingProvider,
  embeddingProviderContract,
  type EmbeddingProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  TITAN_EMBEDDING_CAPABILITIES,
  TITAN_TEXT_EMBEDDINGS_V2_MODEL_ID,
  TitanEmbeddingProvider,
  type BedrockRuntimeCommandClient,
} from "./titan-embedding-provider";

const FIXED_CHECKED_AT = "2026-07-24T00:00:00.000Z";

function vector(dimensions: 512 | 1024): readonly number[] {
  return Array.from({ length: dimensions }, (_, index) => index / dimensions);
}

function encodedResponse(dimensions: 512 | 1024): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ embedding: vector(dimensions), inputTextTokenCount: 3 }),
  );
}

function requestBody(command: InvokeModelCommand): {
  readonly inputText: string;
  readonly dimensions: number;
  readonly normalize: boolean;
} {
  return JSON.parse(
    Buffer.from(command.input.body as Uint8Array).toString("utf8"),
  ) as { inputText: string; dimensions: number; normalize: boolean };
}

function fakeClient(
  handler: (command: InvokeModelCommand) => Promise<{ readonly body: Uint8Array }>,
): BedrockRuntimeCommandClient {
  return {
    send: vi.fn(async (command: InvokeModelCommand) => handler(command)),
  } as unknown as BedrockRuntimeCommandClient;
}

function realProvider(): EmbeddingProvider {
  const client = fakeClient(async (command) => {
    const body = requestBody(command);
    return { body: encodedResponse(body.dimensions as 512 | 1024) };
  });
  return new TitanEmbeddingProvider(
    { region: "ap-south-1" },
    client,
    () => new Date(FIXED_CHECKED_AT),
  );
}

function equivalentMockProvider(): EmbeddingProvider {
  return createMockEmbeddingProvider({
    modelId: TITAN_TEXT_EMBEDDINGS_V2_MODEL_ID,
    capabilities: TITAN_EMBEDDING_CAPABILITIES,
    health: {
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: {
        configured: true,
        modelId: TITAN_TEXT_EMBEDDINGS_V2_MODEL_ID,
        liveProbe: false,
      },
    },
  });
}

describe("TitanEmbeddingProvider", () => {
  it.each([512, 1024] as const)(
    "sends Titan V2 InvokeModel request for %i dimensions",
    async (dimensions) => {
      const send = vi.fn(async (command: InvokeModelCommand) => {
        expect(command.input.modelId).toBe(TITAN_TEXT_EMBEDDINGS_V2_MODEL_ID);
        expect(command.input.contentType).toBe("application/json");
        expect(command.input.accept).toBe("application/json");
        expect(requestBody(command)).toEqual({
          inputText: "embed this",
          dimensions,
          normalize: true,
        });
        return { body: encodedResponse(dimensions) };
      });
      const provider = new TitanEmbeddingProvider(
        { region: "ap-south-1" },
        { send } as unknown as BedrockRuntimeCommandClient,
      );

      const result = await provider.embed({
        tenantId: "tenant-1",
        text: "embed this",
        dimensions,
      });

      expect(result).toMatchObject({
        dimensions,
        modelId: TITAN_TEXT_EMBEDDINGS_V2_MODEL_ID,
      });
      expect(result.vector).toHaveLength(dimensions);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it("supports explicit model ID and normalize override", async () => {
    const send = vi.fn(async (command: InvokeModelCommand) => {
      expect(command.input.modelId).toBe("custom.titan");
      expect(requestBody(command).normalize).toBe(false);
      return { body: encodedResponse(512) };
    });
    const provider = new TitanEmbeddingProvider(
      { region: "ap-south-1", modelId: "custom.titan", normalize: false },
      { send } as unknown as BedrockRuntimeCommandClient,
    );

    await expect(
      provider.embed({
        tenantId: "tenant-1",
        text: "embed this",
        dimensions: 512,
      }),
    ).resolves.toMatchObject({ modelId: "custom.titan" });
  });

  it("rejects invalid request and response shapes", async () => {
    const provider = new TitanEmbeddingProvider(
      { region: "ap-south-1" },
      fakeClient(async () => ({ body: encodedResponse(512) })),
    );

    await expect(
      provider.embed({ tenantId: "", text: "x", dimensions: 512 }),
    ).rejects.toThrow(/tenantId/);
    await expect(
      provider.embed({ tenantId: "tenant-1", text: "", dimensions: 512 }),
    ).rejects.toThrow(/text/);
    await expect(
      provider.embed({
        tenantId: "tenant-1",
        text: "x",
        dimensions: 256 as 512,
      }),
    ).rejects.toThrow(/512 or 1024/);

    await expect(
      new TitanEmbeddingProvider(
        { region: "ap-south-1" },
        fakeClient(async () => ({ body: new TextEncoder().encode("{}") })),
      ).embed({ tenantId: "tenant-1", text: "x", dimensions: 512 }),
    ).rejects.toThrow(/embedding array/);

    await expect(
      new TitanEmbeddingProvider(
        { region: "ap-south-1" },
        fakeClient(async () => ({
          body: new TextEncoder().encode(JSON.stringify({ embedding: [NaN] })),
        })),
      ).embed({ tenantId: "tenant-1", text: "x", dimensions: 512 }),
    ).rejects.toThrow(/non-number/);

    await expect(
      new TitanEmbeddingProvider(
        { region: "ap-south-1" },
        fakeClient(async () => ({
          body: new TextEncoder().encode(JSON.stringify({ embedding: [1] })),
        })),
      ).embed({ tenantId: "tenant-1", text: "x", dimensions: 512 }),
    ).rejects.toThrow(/did not match/);
  });

  it("validates required config at construction", () => {
    expect(() => new TitanEmbeddingProvider({ region: "" })).toThrow(/region/);
    expect(
      () => new TitanEmbeddingProvider({ region: "ap-south-1", modelId: "" }),
    ).toThrow(/model ID/);
  });

  it("reports configured health without making a live Bedrock call", async () => {
    const send = vi.fn();
    const provider = new TitanEmbeddingProvider(
      { region: "ap-south-1" },
      { send } as unknown as BedrockRuntimeCommandClient,
      () => new Date(FIXED_CHECKED_AT),
    );

    await expect(provider.healthCheck()).resolves.toEqual({
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: {
        configured: true,
        modelId: TITAN_TEXT_EMBEDDINGS_V2_MODEL_ID,
        liveProbe: false,
      },
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("EmbeddingProvider contract", () => {
  it("passes the unmodified shared contract suite with the real Titan adapter", async () => {
    const report = await assertProviderContractParity(embeddingProviderContract, [
      { name: "titan-primary", create: realProvider },
      { name: "titan-parity", create: realProvider },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });

  it("passes the unmodified shared contract suite across the real adapter and the mock", async () => {
    const report = await assertProviderContractParity(embeddingProviderContract, [
      { name: "titan-real", create: realProvider },
      { name: "titan-mock", create: equivalentMockProvider },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(6);
  });
});
