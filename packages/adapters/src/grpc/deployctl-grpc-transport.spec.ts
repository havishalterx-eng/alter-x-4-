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
  DeployctlPromoteVersionRequest,
  DeployctlRollbackVersionRequest,
  DeployctlStartCanaryRequest,
} from "@alterx/contracts";
import {
  DEPLOYCTL_HANDLER,
  DeployctlGrpcController,
  connectDeployctlGrpcTransport,
  type DeployctlHandler,
} from "./deployctl-grpc-transport";

interface DeployctlGrpcClient extends Client {
  promoteVersion(
    request: DeployctlPromoteVersionRequest,
    callback: (
      error: ServiceError | null,
      response: { status: string; promoted_at: string },
    ) => void,
  ): void;
  startCanary(
    request: DeployctlStartCanaryRequest,
    callback: (
      error: ServiceError | null,
      response: { status: string; traffic_percent: number },
    ) => void,
  ): void;
  rollbackVersion(
    request: DeployctlRollbackVersionRequest,
    callback: (
      error: ServiceError | null,
      response: { status: string; active_version_id: string },
    ) => void,
  ): void;
}

interface DeployctlPackageDefinition {
  readonly alter: {
    readonly deployctl: {
      readonly v1: {
        readonly DeployctlService: ServiceClientConstructor;
      };
    };
  };
}

const protoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/deployctl/v1/deployctl.proto",
);

const promoteRequest: DeployctlPromoteVersionRequest = {
  tenant_id: "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  workflow_id: "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  workflow_version_id: "wfv_018f4d6e-2b4a-7a3e-8c1a-1234567890a1",
};
const canaryRequest: DeployctlStartCanaryRequest = {
  ...promoteRequest,
  traffic_percent: 10,
};
const rollbackRequest: DeployctlRollbackVersionRequest = {
  tenant_id: promoteRequest.tenant_id,
  workflow_id: promoteRequest.workflow_id,
  target_version_id: promoteRequest.workflow_version_id,
};

function handler(): DeployctlHandler {
  return {
    promoteVersion: vi.fn(async () => ({
      status: "promoted",
      promoted_at: "2026-07-26T10:00:00.000Z",
    })),
    startCanary: vi.fn(async (request) => ({
      status: "canary",
      traffic_percent: request.traffic_percent,
    })),
    rollbackVersion: vi.fn(async (request) => ({
      status: "rolled_back",
      active_version_id: request.target_version_id,
    })),
  };
}

@Module({
  controllers: [DeployctlGrpcController],
  providers: [{ provide: DEPLOYCTL_HANDLER, useValue: handler() }],
})
class DeployctlGrpcTestModule {}

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

function unary<Request, Response>(
  call: (
    request: Request,
    callback: (error: ServiceError | null, response: Response) => void,
  ) => void,
  request: Request,
): Promise<Response> {
  return new Promise((resolveResponse, reject) => {
    call(request, (error, response) => {
      if (error === null) {
        resolveResponse(response);
      } else {
        reject(error);
      }
    });
  });
}

class NamedDeploymentError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

describe("DeployctlGrpcController", () => {
  it("delegates all three locked deployctl RPC shapes", async () => {
    const controller = new DeployctlGrpcController(handler());

    await expect(controller.promoteVersion(promoteRequest)).resolves.toEqual({
      status: "promoted",
      promoted_at: "2026-07-26T10:00:00.000Z",
    });
    await expect(controller.startCanary(canaryRequest)).resolves.toEqual({
      status: "canary",
      traffic_percent: 10,
    });
    await expect(controller.rollbackVersion(rollbackRequest)).resolves.toEqual({
      status: "rolled_back",
      active_version_id: rollbackRequest.target_version_id,
    });
  });

  it.each([
    ["DeploymentValidationError", 3],
    ["DeploymentNotFoundError", 5],
    ["DeploymentStateTransitionError", 9],
    ["DeploymentConcurrencyError", 10],
  ] as const)("maps %s to gRPC status %s", async (name, code) => {
    const failing = handler();
    failing.promoteVersion = vi.fn(async () => {
      throw new NamedDeploymentError(name, "safe lifecycle error");
    });
    const controller = new DeployctlGrpcController(failing);

    await expect(controller.promoteVersion(promoteRequest)).rejects.toMatchObject({
      error: { code, message: "safe lifecycle error" },
    });
  });

  it("hides unexpected internals behind a stable INTERNAL response", async () => {
    const failing = handler();
    failing.startCanary = vi.fn(async () => {
      throw new Error("database topology and credential details");
    });
    const controller = new DeployctlGrpcController(failing);

    await expect(controller.startCanary(canaryRequest)).rejects.toMatchObject({
      error: {
        code: 13,
        message: "Workflow canary could not be started",
      },
    });
  });
});

describe("Deployctl gRPC transport adapter", () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let client: DeployctlGrpcClient;

  beforeAll(async () => {
    app = await NestFactory.create(
      DeployctlGrpcTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    const port = await availablePort();
    connectDeployctlGrpcTransport(app, {
      bindAddress: `127.0.0.1:${port}`,
      protoPath,
    });
    await app.startAllMicroservices();
    await app.init();

    const loaded = loadPackageDefinition(
      loadSync(protoPath, { keepCase: true }),
    ) as unknown as DeployctlPackageDefinition;
    client = new loaded.alter.deployctl.v1.DeployctlService(
      `127.0.0.1:${port}`,
      credentials.createInsecure(),
    ) as unknown as DeployctlGrpcClient;
  });

  afterAll(async () => {
    client.close();
    await app.close();
  });

  it("round-trips all declared Deployctl RPCs through generated contract types", async () => {
    await expect(
      unary(client.promoteVersion.bind(client), promoteRequest),
    ).resolves.toEqual({
      status: "promoted",
      promoted_at: "2026-07-26T10:00:00.000Z",
    });
    await expect(
      unary(client.startCanary.bind(client), canaryRequest),
    ).resolves.toEqual({ status: "canary", traffic_percent: 10 });
    await expect(
      unary(client.rollbackVersion.bind(client), rollbackRequest),
    ).resolves.toEqual({
      status: "rolled_back",
      active_version_id: rollbackRequest.target_version_id,
    });
  });
});
