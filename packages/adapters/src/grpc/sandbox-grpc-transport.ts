import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  SandboxCloseSessionRequest,
  SandboxCloseSessionResponse,
  SandboxExecuteRequest,
  SandboxExecuteResponse,
  SandboxReadFileRequest,
  SandboxReadFileResponse,
  SandboxRunVerificationSuiteRequest,
  SandboxRunVerificationSuiteResponse,
  SandboxWriteFileRequest,
  SandboxWriteFileResponse,
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
  readFile(request: SandboxReadFileRequest): Promise<SandboxReadFileResponse>;
  writeFile(request: SandboxWriteFileRequest): Promise<SandboxWriteFileResponse>;
  runVerificationSuite(
    request: SandboxRunVerificationSuiteRequest,
  ): Promise<SandboxRunVerificationSuiteResponse>;
  closeSession(
    request: SandboxCloseSessionRequest,
  ): Promise<SandboxCloseSessionResponse>;
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

  @GrpcMethod("SandboxService", "ReadFile")
  async readFile(request: SandboxReadFileRequest): Promise<SandboxReadFileResponse> {
    try { return await this.handler.readFile(request); } catch (error: unknown) { throw mapSandboxError(error); }
  }

  @GrpcMethod("SandboxService", "WriteFile")
  async writeFile(request: SandboxWriteFileRequest): Promise<SandboxWriteFileResponse> {
    try { return await this.handler.writeFile(request); } catch (error: unknown) { throw mapSandboxError(error); }
  }

  @GrpcMethod("SandboxService", "RunVerificationSuite")
  async runVerificationSuite(
    request: SandboxRunVerificationSuiteRequest,
  ): Promise<SandboxRunVerificationSuiteResponse> {
    try { return await this.handler.runVerificationSuite(request); } catch (error: unknown) { throw mapSandboxError(error); }
  }

  @GrpcMethod("SandboxService", "CloseSession")
  async closeSession(
    request: SandboxCloseSessionRequest,
  ): Promise<SandboxCloseSessionResponse> {
    try { return await this.handler.closeSession(request); } catch (error: unknown) { throw mapSandboxError(error); }
  }
}

function mapSandboxError(error: unknown): RpcException {
  if (error instanceof SandboxGrpcValidationError) return new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
  return new RpcException({ code: status.INTERNAL, message: "Sandbox file operation could not be completed" });
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
  }, { inheritAppConfig: true });
  await app.startAllMicroservices();
}
