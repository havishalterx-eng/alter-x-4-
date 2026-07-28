import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  SandboxExecuteRequest,
  SandboxExecuteResponse,
} from "@alterx/contracts";

export const SANDBOX_HANDLER = Symbol("SANDBOX_HANDLER");

export class SandboxGrpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxGrpcValidationError";
  }
}

export interface SandboxGrpcHandler {
  execute(request: SandboxExecuteRequest): Promise<SandboxExecuteResponse>;
}

export interface SandboxGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class SandboxGrpcController {
  constructor(
    @Inject(SANDBOX_HANDLER) private readonly handler: SandboxGrpcHandler,
  ) {}

  @GrpcMethod("SandboxService", "Execute")
  async execute(
    request: SandboxExecuteRequest,
  ): Promise<SandboxExecuteResponse> {
    try {
      return await this.handler.execute(request);
    } catch (error: unknown) {
      if (error instanceof SandboxGrpcValidationError) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: error.message,
        });
      }
      throw new RpcException({
        code: status.INTERNAL,
        message: "Sandbox execution could not be completed",
      });
    }
  }
}

export async function startSandboxGrpcTransport(
  app: INestApplication,
  config: SandboxGrpcTransportConfig,
): Promise<void> {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.sandbox.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  });
  await app.startAllMicroservices();
}
