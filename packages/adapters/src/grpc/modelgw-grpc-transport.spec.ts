import { createServer } from "node:net";
import { resolve } from "node:path";

import {
  credentials,
  loadPackageDefinition,
  type Client,
  type ClientReadableStream,
  type ServiceClientConstructor,
  type ServiceError,
} from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  ModelgwEmbedRequest,
  ModelgwEmbedResponse,
  ModelgwInvokeRequest,
  ModelgwInvokeResponse,
  ModelgwRedactRequest,
  ModelgwRedactResponse,
  ModelgwStreamRequest,
  ModelgwStreamResponse,
} from "@alterx/contracts";
import {
  ModelAliasResolutionError,
  ModelGatewayCostLimitExceededError,
} from "@alterx/shared-clients";
import {
  MODELGW_HANDLER,
  ModelgwGrpcController,
  startModelgwGrpcTransport,
  type ModelgwHandler,
} from "./modelgw-grpc-transport";

interface ModelgwGrpcClient extends Client {
  invoke(
    request: ModelgwInvokeRequest,
    callback: (
      error: ServiceError | null,
      response: ModelgwInvokeResponse,
    ) => void,
  ): void;
  stream(
    request: ModelgwStreamRequest,
  ): ClientReadableStream<ModelgwStreamResponse>;
  redact(
    request: ModelgwRedactRequest,
    callback: (
      error: ServiceError | null,
      response: ModelgwRedactResponse,
    ) => void,
  ): void;
  embed(
    request: ModelgwEmbedRequest,
    callback: (
      error: ServiceError | null,
      response: ModelgwEmbedResponse,
    ) => void,
  ): void;
}

interface ModelgwPackageDefinition {
  readonly alter: {
    readonly modelgw: {
      readonly v1: {
        readonly ModelgwService: ServiceClientConstructor;
      };
    };
  };
}

const protoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/modelgw/v1/modelgw.proto",
);

const handler: ModelgwHandler = {
  invoke: vi.fn(async (request: ModelgwInvokeRequest) => {
    if (request.model_alias === "UNKNOWN") {
      throw new ModelAliasResolutionError(request.model_alias);
    }
    return {
      output_json: JSON.stringify({ ok: true }),
      usage_json: JSON.stringify({ input_tokens: 1, output_tokens: 1 }),
      resolved_capability: request.model_alias,
    } satisfies ModelgwInvokeResponse;
  }),
  stream: async function* (request: ModelgwStreamRequest) {
    if (request.model_alias === "UNKNOWN") {
      throw new ModelAliasResolutionError(request.model_alias);
    }
    if (request.model_alias === "CEILING") {
      throw new ModelGatewayCostLimitExceededError("stream budget exceeded");
    }
    if (request.model_alias === "ADVANCED") {
      throw new Error("aws credential and internals");
    }
    yield { sequence: 1, delta: "hello", final: false };
    yield { sequence: 2, delta: " world", final: false };
    yield { sequence: 3, delta: "", final: true };
  },
  redact: vi.fn(async (request: ModelgwRedactRequest) => {
    return {
      redacted_content: request.content.replace("ABCDE1234F", "<IN_PAN>"),
      redaction_count: request.content.includes("ABCDE1234F") ? 1 : 0,
    } satisfies ModelgwRedactResponse;
  }),
  embed: vi.fn(async (request: ModelgwEmbedRequest) => {
    return {
      embedding: Array.from({ length: request.dimensions }, () => 0.5),
      dimensions: request.dimensions,
      model_id: "amazon.titan-embed-text-v2:0",
    } satisfies ModelgwEmbedResponse;
  }),
};

function request(
  overrides: Partial<ModelgwInvokeRequest> = {},
): ModelgwInvokeRequest {
  return {
    tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
    run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
    node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
    model_alias: "STANDARD",
    input_json: JSON.stringify({ prompt: "hello" }),
    ...overrides,
  };
}

async function stream(
  client: ModelgwGrpcClient,
  req: ModelgwStreamRequest,
): Promise<ModelgwStreamResponse[]> {
  const responses: ModelgwStreamResponse[] = [];
  for await (const response of client.stream(req)) {
    responses.push(response);
  }
  return responses;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePort);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not allocate local gRPC port");
  }
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) =>
      error === undefined ? resolveClose() : reject(error),
    );
  });
  return address.port;
}

function invoke(
  client: ModelgwGrpcClient,
  req: ModelgwInvokeRequest,
): Promise<ModelgwInvokeResponse> {
  return new Promise((resolveResponse, reject) => {
    client.invoke(req, (error, response) => {
      if (error === null) {
        resolveResponse(response);
      } else {
        reject(error);
      }
    });
  });
}

function redact(
  client: ModelgwGrpcClient,
  req: ModelgwRedactRequest,
): Promise<ModelgwRedactResponse> {
  return new Promise((resolveResponse, reject) => {
    client.redact(req, (error, response) => {
      if (error === null) {
        resolveResponse(response);
      } else {
        reject(error);
      }
    });
  });
}

function embed(
  client: ModelgwGrpcClient,
  req: ModelgwEmbedRequest,
): Promise<ModelgwEmbedResponse> {
  return new Promise((resolveResponse, reject) => {
    client.embed(req, (error, response) => {
      if (error === null) {
        resolveResponse(response);
      } else {
        reject(error);
      }
    });
  });
}

@Module({
  controllers: [ModelgwGrpcController],
  providers: [{ provide: MODELGW_HANDLER, useValue: handler }],
})
class ModelgwGrpcTestModule {}

describe("modelgw gRPC transport adapter", () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let client: ModelgwGrpcClient;

  beforeAll(async () => {
    app = await NestFactory.create(ModelgwGrpcTestModule, new FastifyAdapter(), {
      logger: false,
    });
    const port = await availablePort();
    await startModelgwGrpcTransport(app, {
      bindAddress: `127.0.0.1:${port}`,
      protoPath,
    });
    await app.init();

    const loaded = loadPackageDefinition(
      loadSync(protoPath, { keepCase: true, longs: Number }),
    ) as unknown as ModelgwPackageDefinition;
    client = new loaded.alter.modelgw.v1.ModelgwService(
      `127.0.0.1:${port}`,
      credentials.createInsecure(),
    ) as unknown as ModelgwGrpcClient;
  });

  afterAll(async () => {
    client.close();
    await app.close();
  });

  it("round-trips an invoke request through the generated contract types", async () => {
    await expect(invoke(client, request())).resolves.toEqual({
      output_json: JSON.stringify({ ok: true }),
      usage_json: JSON.stringify({ input_tokens: 1, output_tokens: 1 }),
      resolved_capability: "STANDARD",
    });
  });

  it("streams incremental responses through the declared server-streaming RPC", async () => {
    await expect(stream(client, request())).resolves.toEqual([
      { sequence: 1, delta: "hello", final: false },
      { sequence: 2, delta: " world", final: false },
      { sequence: 3, delta: "", final: true },
    ]);
  });

  it("maps stream alias failures to INVALID_ARGUMENT", async () => {
    await expect(
      stream(client, request({ model_alias: "UNKNOWN" })),
    ).rejects.toMatchObject({ code: 3 });
  });

  it("maps stream cost failures to RESOURCE_EXHAUSTED", async () => {
    await expect(
      stream(client, request({ model_alias: "CEILING" })),
    ).rejects.toMatchObject({ code: 8 });
  });

  it("hides unexpected stream failures behind INTERNAL", async () => {
    await expect(
      stream(client, request({ model_alias: "ADVANCED" })),
    ).rejects.toMatchObject({
      code: 13,
      details: "Model stream could not be completed",
    });
  });

  it("maps unresolvable aliases to INVALID_ARGUMENT", async () => {
    await expect(
      invoke(client, request({ model_alias: "UNKNOWN" })),
    ).rejects.toMatchObject({ code: 3 });
  });

  it("hides internal handler failures behind INTERNAL", async () => {
    const failing = new ModelgwGrpcController({
      invoke: vi.fn(async () => {
        throw new Error("aws credential and internals");
      }),
      stream: async function* () {},
      redact: vi.fn(),
      embed: vi.fn(),
    });
    await expect(failing.invoke(request())).rejects.toMatchObject({
      error: {
        code: 13,
        message: "Model invocation could not be completed",
      },
    });
  });

  it("keeps SelectFallback explicitly unimplemented", () => {
    const controller = new ModelgwGrpcController(handler);
    expect(() => controller.selectFallback()).toThrow(/GATE-3/);
  });

  it("round-trips a redact request through the generated contract types", async () => {
    await expect(
      redact(client, {
        tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
        content: "PAN on file: ABCDE1234F",
      }),
    ).resolves.toEqual({
      redacted_content: "PAN on file: <IN_PAN>",
      redaction_count: 1,
    });
  });

  it("hides internal redact handler failures behind INTERNAL", async () => {
    const failing = new ModelgwGrpcController({
      invoke: vi.fn(),
      stream: async function* () {},
      redact: vi.fn(async () => {
        throw new Error("presidio credential and internals");
      }),
      embed: vi.fn(),
    });
    await expect(
      failing.redact({
        tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
        content: "x",
      }),
    ).rejects.toMatchObject({
      error: {
        code: 13,
        message: "PII redaction could not be completed",
      },
    });
  });

  it("round-trips an embed request through the generated contract types", async () => {
    await expect(
      embed(client, {
        tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        text: "hello world",
        dimensions: 1024,
      }),
    ).resolves.toEqual({
      embedding: Array.from({ length: 1024 }, () => 0.5),
      dimensions: 1024,
      model_id: "amazon.titan-embed-text-v2:0",
    });
  });

  it("hides internal embed handler failures behind INTERNAL", async () => {
    const failing = new ModelgwGrpcController({
      invoke: vi.fn(),
      stream: async function* () {},
      redact: vi.fn(),
      embed: vi.fn(async () => {
        throw new Error("bedrock credential and internals");
      }),
    });
    await expect(
      failing.embed({
        tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        text: "x",
        dimensions: 512,
      }),
    ).rejects.toMatchObject({
      error: {
        code: 13,
        message: "Embedding could not be completed",
      },
    });
  });
});
