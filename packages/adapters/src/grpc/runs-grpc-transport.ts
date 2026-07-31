import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  RunsGetNodeExecutionRecoveryInfoRequest,
  RunsGetNodeExecutionRecoveryInfoResponse,
  RunsGetRunWorkspaceRequest,
  RunsGetRunWorkspaceResponse,
} from "@alterx/contracts";

export const RUNS_HANDLER = Symbol("RUNS_HANDLER");

export interface RunsHandler {
  getRunWorkspace(
    request: RunsGetRunWorkspaceRequest,
  ): Promise<RunsGetRunWorkspaceResponse>;
  getNodeExecutionRecoveryInfo(
    request: RunsGetNodeExecutionRecoveryInfoRequest,
  ): Promise<RunsGetNodeExecutionRecoveryInfoResponse>;
}

export interface RunsGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class RunsGrpcController {
  constructor(@Inject(RUNS_HANDLER) private readonly handler: RunsHandler) {}

  @GrpcMethod("RunLookupService", "GetRunWorkspace")
  async getRunWorkspace(
    request: RunsGetRunWorkspaceRequest,
  ): Promise<RunsGetRunWorkspaceResponse> {
    try {
      return await this.handler.getRunWorkspace(request);
    } catch (error: unknown) {
      throw mapRunsError(error);
    }
  }

  @GrpcMethod("RunLookupService", "GetNodeExecutionRecoveryInfo")
  async getNodeExecutionRecoveryInfo(
    request: RunsGetNodeExecutionRecoveryInfoRequest,
  ): Promise<RunsGetNodeExecutionRecoveryInfoResponse> {
    try {
      return await this.handler.getNodeExecutionRecoveryInfo(request);
    } catch (error: unknown) {
      throw mapRunsError(error);
    }
  }
}

/** Connect-only: orchestration bootstrap starts all transports once. */
export function connectRunsGrpcTransport(
  app: INestApplication,
  config: RunsGrpcTransportConfig,
): void {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.runs.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  });
}

function mapRunsError(error: unknown): RpcException {
  if (isNamedError(error, "RunValidationError")) {
    return new RpcException({
      code: status.INVALID_ARGUMENT,
      message: error.message,
    });
  }
  if (isNamedError(error, "RunNotFoundError") || isNamedError(error, "NodeExecutionNotFoundError")) {
    return new RpcException({
      code: status.NOT_FOUND,
      message: error.message,
    });
  }
  return new RpcException({
    code: status.INTERNAL,
    message: "Run workspace lookup could not be completed",
  });
}

function isNamedError(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}
