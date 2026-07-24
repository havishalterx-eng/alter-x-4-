import { createServer } from "node:net";
import { resolve } from "node:path";

import {
  credentials,
  loadPackageDefinition,
  type Client,
  type ServiceClientConstructor,
  type ServiceError,
} from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  ModelgwInvokeRequest,
  ModelgwInvokeResponse,
} from "@alterx/contracts";
import { ModelAliasResolutionError } from "@alterx/shared-clients";
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
    request: ModelgwInvokeRequest,
    callback: (error: ServiceError | null, response: unknown) => void,
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
      loadSync(protoPath, { keepCase: true }),
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
    });
    await expect(failing.invoke(request())).rejects.toMatchObject({
      error: {
        code: 13,
        message: "Model invocation could not be completed",
      },
    });
  });

  it("reports Stream, Redact, and SelectFallback as not yet implemented", () => {
    const controller = new ModelgwGrpcController(handler);
    expect(() => controller.stream()).toThrow(/later Gateways ticket/);
    expect(() => controller.redact()).toThrow(/later Gateways ticket/);
    expect(() => controller.selectFallback()).toThrow(/GATE-3/);
  });
});
