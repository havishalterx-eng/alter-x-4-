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
  RecordEventRequest,
  RecordEventResponse,
} from "@alterx/contracts";
import {
  AUDIT_EVENT_HANDLER,
  AuditValidationError,
  type AuditEventHandler,
} from "@alterx/shared-clients";
import {
  AuditGrpcController,
  startAuditGrpcTransport,
} from "./audit-grpc-transport";

interface AuditGrpcClient extends Client {
  recordEvent(
    request: RecordEventRequest,
    callback: (
      error: ServiceError | null,
      response: RecordEventResponse,
    ) => void,
  ): void;
}

interface AuditPackageDefinition {
  readonly alter: {
    readonly audit: {
      readonly v1: {
        readonly AuditService: ServiceClientConstructor;
      };
    };
  };
}

const protoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/audit/v1/audit.proto",
);

const handler: AuditEventHandler = {
  recordEvent: vi.fn(async (request: RecordEventRequest) => {
    if (request.actor_ref.length === 0) {
      throw new AuditValidationError("actor_ref is required");
    }
    return {
      id: "aud_018f47a2-7b11-7b11-8a11-1234567890ab",
      entry_hash: "a".repeat(64),
    } satisfies RecordEventResponse;
  }),
};

@Module({
  controllers: [AuditGrpcController],
  providers: [{ provide: AUDIT_EVENT_HANDLER, useValue: handler }],
})
class AuditGrpcTestModule {}

function request(
  overrides: Partial<RecordEventRequest> = {},
): RecordEventRequest {
  return {
    tenant_id: "",
    actor_type: "system",
    actor_ref: "system-test",
    action: "system.test",
    target_type: "",
    target_ref: "",
    result: "success",
    reason_code: "",
    context_json: "",
    occurred_at: "2026-07-24T06:30:00.000Z",
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

function recordEvent(
  client: AuditGrpcClient,
  event: RecordEventRequest,
): Promise<RecordEventResponse> {
  return new Promise((resolveResponse, reject) => {
    client.recordEvent(event, (error, response) => {
      if (error === null) {
        resolveResponse(response);
      } else {
        reject(error);
      }
    });
  });
}

describe("audit gRPC transport adapter", () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let client: AuditGrpcClient;

  beforeAll(async () => {
    app = await NestFactory.create(
      AuditGrpcTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    const port = await availablePort();
    await startAuditGrpcTransport(app, {
      bindAddress: `127.0.0.1:${port}`,
      protoPath,
    });
    await app.init();

    const loaded = loadPackageDefinition(
      loadSync(protoPath, { keepCase: true }),
    ) as unknown as AuditPackageDefinition;
    client = new loaded.alter.audit.v1.AuditService(
      `127.0.0.1:${port}`,
      credentials.createInsecure(),
    ) as unknown as AuditGrpcClient;
  });

  afterAll(async () => {
    client.close();
    await app.close();
  });

  it("round-trips generated request and response types", async () => {
    await expect(recordEvent(client, request())).resolves.toEqual({
      id: "aud_018f47a2-7b11-7b11-8a11-1234567890ab",
      entry_hash: "a".repeat(64),
    });
    expect(handler.recordEvent).toHaveBeenCalledWith(request());
  });

  it("maps validation errors to INVALID_ARGUMENT", async () => {
    await expect(
      recordEvent(client, request({ actor_ref: "" })),
    ).rejects.toMatchObject({ code: 3 });
  });

  it("hides internal handler failures", async () => {
    const failing = new AuditGrpcController({
      recordEvent: vi.fn(async () => {
        throw new Error("database credential and internals");
      }),
    });
    await expect(failing.recordEvent(request())).rejects.toMatchObject({
      error: {
        code: 13,
        message: "Audit event could not be recorded",
      },
    });
  });
});
