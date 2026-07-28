import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  NodeexecExecuteNodeRequest,
  NodeexecExecuteNodeResponse,
  NodeexecFinalizeRunRequest,
  NodeexecFinalizeRunResponse,
} from "@alterx/contracts";

export const NODEEXEC_HANDLER = Symbol("NODEEXEC_HANDLER");

export interface NodeexecHandler {
  executeNode(
    request: NodeexecExecuteNodeRequest,
  ): Promise<NodeexecExecuteNodeResponse>;
  finalizeRun(
    request: NodeexecFinalizeRunRequest,
  ): Promise<NodeexecFinalizeRunResponse>;
}

export interface NodeexecGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class NodeexecGrpcController {
  constructor(
    @Inject(NODEEXEC_HANDLER)
    private readonly handler: NodeexecHandler,
  ) {}

  @GrpcMethod("NodeExecutionService", "ExecuteNode")
  async executeNode(
    request: NodeexecExecuteNodeRequest,
  ): Promise<NodeexecExecuteNodeResponse> {
    try {
      return await this.handler.executeNode(request);
    } catch (error: unknown) {
      throw mapNodeexecError(error, "Node could not be executed");
    }
  }

  @GrpcMethod("NodeExecutionService", "FinalizeRun")
  async finalizeRun(
    request: NodeexecFinalizeRunRequest,
  ): Promise<NodeexecFinalizeRunResponse> {
    try {
      return await this.handler.finalizeRun(request);
    } catch (error: unknown) {
      throw mapNodeexecError(error, "Run could not be finalized");
    }
  }
}

/**
 * Connects (but does not start) the Node Execution gRPC microservice.
 * Same connect-only convention as connectCompilerGrpcTransport/
 * connectRegistryGrpcTransport -- the last transport connected in a
 * multi-transport bootstrap calls startAllMicroservices().
 */
export function connectNodeexecGrpcTransport(
  app: INestApplication,
  config: NodeexecGrpcTransportConfig,
): void {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.nodeexec.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  });
}

function mapNodeexecError(error: unknown, fallbackMessage: string): RpcException {
  if (isNamedError(error, "NodeHandlerValidationError")) {
    return new RpcException({
      code: status.INVALID_ARGUMENT,
      message: error.message,
    });
  }
  if (isNamedError(error, "NodeTypeNotImplementedError")) {
    return new RpcException({
      code: status.UNIMPLEMENTED,
      message: error.message,
    });
  }
  if (isNamedError(error, "ModelGatewayInvalidResponseError")) {
    return new RpcException({
      code: status.INTERNAL,
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
