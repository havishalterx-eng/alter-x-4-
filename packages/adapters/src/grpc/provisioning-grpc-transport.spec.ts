import { createServer } from "node:net";
import { resolve } from "node:path";

import {
  credentials,
  loadPackageDefinition,
  type Client,
  type ServiceClientConstructor,
} from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  ProvisioningCloseCycleResponse,
  ProvisioningProvisionRequest,
  ProvisioningProvisionResponse,
} from "@alterx/contracts";
import {
  PROVISIONING_HANDLER,
  ProvisioningGrpcController,
  startProvisioningGrpcTransport,
  type ProvisioningGrpcHandler,
} from "./provisioning-grpc-transport";

interface ProvisioningGrpcClient extends Client {
  provision(
    request: ProvisioningProvisionRequest,
    callback: (
      error: Error | null,
      response?: ProvisioningProvisionResponse,
    ) => void,
  ): void;
  closeCycle(
    request: Pick<
      ProvisioningProvisionRequest,
      "tenant_id" | "run_id" | "project_id" | "cycle_id"
    >,
    callback: (
      error: Error | null,
      response?: ProvisioningCloseCycleResponse,
    ) => void,
  ): void;
}

interface ProvisioningPackageDefinition {
  readonly alter: {
    readonly provisioning: {
      readonly v1: {
        readonly ProvisioningService: ServiceClientConstructor;
      };
    };
  };
}

const protoPath = resolve(
  process.cwd(),
  "packages/contracts/proto/alter/provisioning/v1/provisioning.proto",
);

const request: ProvisioningProvisionRequest = {
  tenant_id: "ten_1",
  run_id: "run_1",
  project_id: "prj_1",
  cycle_id: "cycle_1",
  template_id: "node",
  environment_refs: {},
  scaffold: [],
};

const handler: ProvisioningGrpcHandler = {
  provision: vi.fn(async () => ({
    session_id: "ses_1",
    project_directory: "/workspace/prj_1",
    reused: false,
  })),
  closeCycle: vi.fn(async () => ({ closed: true })),
};

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

function provision(
  client: ProvisioningGrpcClient,
): Promise<ProvisioningProvisionResponse> {
  return new Promise((resolveResponse, reject) => {
    client.provision(request, (error, response) => {
      if (error !== null) {
        reject(error);
        return;
      }
      if (response === undefined) {
        reject(new Error("Provisioning Service returned an empty response"));
        return;
      }
      resolveResponse(response);
    });
  });
}

@Module({
  controllers: [ProvisioningGrpcController],
  providers: [{ provide: PROVISIONING_HANDLER, useValue: handler }],
})
class ProvisioningGrpcTestModule {}

describe("Provisioning gRPC transport adapter", () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let client: ProvisioningGrpcClient;

  beforeAll(async () => {
    app = await NestFactory.create(
      ProvisioningGrpcTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    const port = await availablePort();
    await startProvisioningGrpcTransport(app, {
      bindAddress: `127.0.0.1:${port}`,
      protoPath,
    });
    await app.init();

    const loaded = loadPackageDefinition(
      loadSync(protoPath, { keepCase: true }),
    ) as unknown as ProvisioningPackageDefinition;
    client = new loaded.alter.provisioning.v1.ProvisioningService(
      `127.0.0.1:${port}`,
      credentials.createInsecure(),
    ) as unknown as ProvisioningGrpcClient;
  });

  afterAll(async () => {
    client.close();
    await app.close();
  });

  it("serves the declared Provision RPC through a real gRPC transport", async () => {
    await expect(provision(client)).resolves.toEqual({
      session_id: "ses_1",
      project_directory: "/workspace/prj_1",
      reused: false,
    });
    expect(handler.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        project_id: request.project_id,
        cycle_id: request.cycle_id,
        template_id: request.template_id,
      }),
    );
  });
});
