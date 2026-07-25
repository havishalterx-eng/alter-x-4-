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
  ConversationClassifyIntentRequest,
  ConversationClassifyIntentResponse,
  ConversationGetGoalStateRequest,
  ConversationGetGoalStateResponse,
  ConversationMergeClarificationRequest,
  ConversationMergeClarificationResponse,
} from "@alterx/contracts";
import {
  CONVERSATION_HANDLER,
  ConversationGrpcController,
  startConversationGrpcTransport,
  type ConversationHandler,
} from "./conversation-grpc-transport";

interface ConversationGrpcClient extends Client {
  classifyIntent(
    request: ConversationClassifyIntentRequest,
    callback: (
      error: ServiceError | null,
      response: ConversationClassifyIntentResponse,
    ) => void,
  ): void;
  getGoalState(
    request: ConversationGetGoalStateRequest,
    callback: (
      error: ServiceError | null,
      response: ConversationGetGoalStateResponse,
    ) => void,
  ): void;
  mergeClarification(
    request: ConversationMergeClarificationRequest,
    callback: (
      error: ServiceError | null,
      response: ConversationMergeClarificationResponse,
    ) => void,
  ): void;
}

interface ConversationPackageDefinition {
  readonly alter: {
    readonly conversation: {
      readonly v1: {
        readonly ConversationService: ServiceClientConstructor;
      };
    };
  };
}

const protoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/conversation/v1/conversation.proto",
);

class ConversationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationValidationError";
  }
}

const handler: ConversationHandler = {
  classifyIntent: vi.fn(async (request: ConversationClassifyIntentRequest) => {
    if (request.utterance === "") {
      throw new ConversationValidationError("utterance is required");
    }
    return {
      intent: "plan",
      confidence: 0.9,
      actionable: true,
    } satisfies ConversationClassifyIntentResponse;
  }),
  getGoalState: vi.fn(async () => ({
    goal_state_json: "{}",
    status: "planning",
    revision: 0,
  })),
  mergeClarification: vi.fn(async (request: ConversationMergeClarificationRequest) => ({
    goal_state_json: JSON.stringify({
      pendingClarifications: { [request.clarification_id]: request.answer },
    }),
    revision: 1,
  })),
};

function classifyRequest(
  overrides: Partial<ConversationClassifyIntentRequest> = {},
): ConversationClassifyIntentRequest {
  return {
    tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
    workspace_id: "ws_018f47a2-7b11-7b11-8a11-1234567890ab",
    conversation_id: "cnv_018f47a2-7b11-7b11-8a11-1234567890ab",
    utterance: "build me a workflow",
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

function classifyIntent(
  client: ConversationGrpcClient,
  req: ConversationClassifyIntentRequest,
): Promise<ConversationClassifyIntentResponse> {
  return new Promise((resolveResponse, reject) => {
    client.classifyIntent(req, (error, response) => {
      if (error === null) {
        resolveResponse(response);
      } else {
        reject(error);
      }
    });
  });
}

function mergeClarification(
  client: ConversationGrpcClient,
  req: ConversationMergeClarificationRequest,
): Promise<ConversationMergeClarificationResponse> {
  return new Promise((resolveResponse, reject) => {
    client.mergeClarification(req, (error, response) => {
      if (error === null) {
        resolveResponse(response);
      } else {
        reject(error);
      }
    });
  });
}

@Module({
  controllers: [ConversationGrpcController],
  providers: [{ provide: CONVERSATION_HANDLER, useValue: handler }],
})
class ConversationGrpcTestModule {}

describe("conversation gRPC transport adapter", () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let client: ConversationGrpcClient;

  beforeAll(async () => {
    app = await NestFactory.create(ConversationGrpcTestModule, new FastifyAdapter(), {
      logger: false,
    });
    const port = await availablePort();
    await startConversationGrpcTransport(app, {
      bindAddress: `127.0.0.1:${port}`,
      protoPath,
    });
    await app.init();

    const loaded = loadPackageDefinition(
      loadSync(protoPath, { keepCase: true }),
    ) as unknown as ConversationPackageDefinition;
    client = new loaded.alter.conversation.v1.ConversationService(
      `127.0.0.1:${port}`,
      credentials.createInsecure(),
    ) as unknown as ConversationGrpcClient;
  });

  afterAll(async () => {
    client.close();
    await app.close();
  });

  it("round-trips a ClassifyIntent request through the generated contract types", async () => {
    await expect(classifyIntent(client, classifyRequest())).resolves.toEqual({
      intent: "plan",
      confidence: 0.9,
      actionable: true,
    });
  });

  it("round-trips a MergeClarification request through the generated contract types", async () => {
    await expect(
      mergeClarification(client, {
        tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        conversation_id: "cnv_018f47a2-7b11-7b11-8a11-1234567890ab",
        clarification_id: "clr_1",
        answer: "yes",
      }),
    ).resolves.toEqual({
      goal_state_json: JSON.stringify({ pendingClarifications: { clr_1: "yes" } }),
      revision: 1,
    });
  });

  it("maps a ConversationValidationError to INVALID_ARGUMENT", async () => {
    await expect(
      classifyIntent(client, classifyRequest({ utterance: "" })),
    ).rejects.toMatchObject({ code: 3 });
  });

  it("hides internal handler failures behind INTERNAL", async () => {
    const failing = new ConversationGrpcController({
      classifyIntent: vi.fn(async () => {
        throw new Error("bedrock credential and internals");
      }),
      getGoalState: vi.fn(),
      mergeClarification: vi.fn(),
    });
    await expect(failing.classifyIntent(classifyRequest())).rejects.toMatchObject({
      error: {
        code: 13,
        message: "Intent classification could not be completed",
      },
    });
  });

  it("maps a ConversationConcurrencyError to ABORTED", async () => {
    class ConversationConcurrencyError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "ConversationConcurrencyError";
      }
    }
    const failing = new ConversationGrpcController({
      classifyIntent: vi.fn(),
      getGoalState: vi.fn(),
      mergeClarification: vi.fn(async () => {
        throw new ConversationConcurrencyError("too much contention");
      }),
    });
    await expect(
      failing.mergeClarification({
        tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        conversation_id: "cnv_018f47a2-7b11-7b11-8a11-1234567890ab",
        clarification_id: "clr_1",
        answer: "yes",
      }),
    ).rejects.toMatchObject({ error: { code: 10 } });
  });
});
