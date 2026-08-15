import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  RunsCreateRunRequest,
  RunsCreateRunResponse,
  RunsGetNodeExecutionRecoveryInfoRequest,
  RunsGetNodeExecutionRecoveryInfoResponse,
  RunsGetRunWorkspaceRequest,
  RunsGetRunWorkspaceResponse,
} from "@alterx/contracts";

export const RUNS_HANDLER = Symbol("RUNS_HANDLER");

export const RUNS_DISPATCH_HANDLER = Symbol("RUNS_DISPATCH_HANDLER");

export interface RunsHandler {
  getRunWorkspace(
    request: RunsGetRunWorkspaceRequest,
  ): Promise<RunsGetRunWorkspaceResponse>;
  getNodeExecutionRecoveryInfo(
    request: RunsGetNodeExecutionRecoveryInfoRequest,
  ): Promise<RunsGetNodeExecutionRecoveryInfoResponse>;
}

export interface RunDispatchHandler {
  createRun(request: RunsCreateRunRequest): Promise<RunsCreateRunResponse>;
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

/**
 * INGR-7: gRPC surface for RunDispatchService.CreateRun (the canonical
 * event path). Same package alter.runs.v1 as RunLookupService, so the same
 * transport connection serves both -- this controller only adds the RPC.
 */
@Controller()
export class RunDispatchGrpcController {
  constructor(
    @Inject(RUNS_DISPATCH_HANDLER) private readonly handler: RunDispatchHandler,
  ) {}

  @GrpcMethod("RunDispatchService", "CreateRun")
  async createRun(
    request: RunsCreateRunRequest,
  ): Promise<RunsCreateRunResponse> {
    try {
      return await this.handler.createRun(request);
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
  if (isNamedError(error, "RunValidationError") || isNamedError(error, "TriggerEventValidationError")) {
    return new RpcException({
      code: status.INVALID_ARGUMENT,
      message: error.message,
    });
  }
  if (
    isNamedError(error, "RunNotFoundError") ||
    isNamedError(error, "NodeExecutionNotFoundError") ||
    isNamedError(error, "TriggerEventNotFoundError")
  ) {
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
