import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  DeployctlPromoteVersionRequest,
  DeployctlPromoteVersionResponse,
  DeployctlRollbackVersionRequest,
  DeployctlRollbackVersionResponse,
  DeployctlStartCanaryRequest,
  DeployctlStartCanaryResponse,
} from "@alterx/contracts";

export const DEPLOYCTL_HANDLER = Symbol("DEPLOYCTL_HANDLER");

export interface DeployctlHandler {
  promoteVersion(
    request: DeployctlPromoteVersionRequest,
  ): Promise<DeployctlPromoteVersionResponse>;
  startCanary(
    request: DeployctlStartCanaryRequest,
  ): Promise<DeployctlStartCanaryResponse>;
  rollbackVersion(
    request: DeployctlRollbackVersionRequest,
  ): Promise<DeployctlRollbackVersionResponse>;
}

export interface DeployctlGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class DeployctlGrpcController {
  constructor(
    @Inject(DEPLOYCTL_HANDLER)
    private readonly handler: DeployctlHandler,
  ) {}

  @GrpcMethod("DeployctlService", "PromoteVersion")
  async promoteVersion(
    request: DeployctlPromoteVersionRequest,
  ): Promise<DeployctlPromoteVersionResponse> {
    try {
      return await this.handler.promoteVersion(request);
    } catch (error: unknown) {
      throw mapDeploymentError(error, "Workflow version could not be promoted");
    }
  }

  @GrpcMethod("DeployctlService", "StartCanary")
  async startCanary(
    request: DeployctlStartCanaryRequest,
  ): Promise<DeployctlStartCanaryResponse> {
    try {
      return await this.handler.startCanary(request);
    } catch (error: unknown) {
      throw mapDeploymentError(error, "Workflow canary could not be started");
    }
  }

  @GrpcMethod("DeployctlService", "RollbackVersion")
  async rollbackVersion(
    request: DeployctlRollbackVersionRequest,
  ): Promise<DeployctlRollbackVersionResponse> {
    try {
      return await this.handler.rollbackVersion(request);
    } catch (error: unknown) {
      throw mapDeploymentError(error, "Workflow version could not be rolled back");
    }
  }
}

export function connectDeployctlGrpcTransport(
  app: INestApplication,
  config: DeployctlGrpcTransportConfig,
): void {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.deployctl.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  });
}

function mapDeploymentError(
  error: unknown,
  fallbackMessage: string,
): RpcException {
  if (isNamedError(error, "DeploymentValidationError")) {
    return new RpcException({
      code: status.INVALID_ARGUMENT,
      message: error.message,
    });
  }
  if (isNamedError(error, "DeploymentNotFoundError")) {
    return new RpcException({
      code: status.NOT_FOUND,
      message: error.message,
    });
  }
  if (isNamedError(error, "DeploymentStateTransitionError")) {
    return new RpcException({
      code: status.FAILED_PRECONDITION,
      message: error.message,
    });
  }
  if (isNamedError(error, "DeploymentConcurrencyError")) {
    return new RpcException({
      code: status.ABORTED,
      message: error.message,
    });
  }
  return new RpcException({
    code: status.INTERNAL,
    message: fallbackMessage,
  });
}

function isNamedError(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}
