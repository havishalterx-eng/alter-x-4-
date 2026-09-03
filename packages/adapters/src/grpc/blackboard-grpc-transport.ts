import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  BlackboardReadValueRequest,
  BlackboardReadValueResponse,
  BlackboardWriteValueRequest,
  BlackboardWriteValueResponse,
} from "@alterx/contracts";
import { internalError } from "./internal-error";

export const BLACKBOARD_HANDLER = Symbol("BLACKBOARD_HANDLER");

export interface BlackboardHandler {
  writeValue(
    request: BlackboardWriteValueRequest,
  ): Promise<BlackboardWriteValueResponse>;
  readValue(
    request: BlackboardReadValueRequest,
  ): Promise<BlackboardReadValueResponse>;
}

export interface BlackboardGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class BlackboardGrpcController {
  constructor(
    @Inject(BLACKBOARD_HANDLER)
    private readonly handler: BlackboardHandler,
  ) {}

  @GrpcMethod("BlackboardService", "WriteValue")
  async writeValue(
    request: BlackboardWriteValueRequest,
  ): Promise<BlackboardWriteValueResponse> {
    try {
      return await this.handler.writeValue(request);
    } catch (error: unknown) {
      throw mapBlackboardError(error, "Value could not be written");
    }
  }

  @GrpcMethod("BlackboardService", "ReadValue")
  async readValue(
    request: BlackboardReadValueRequest,
  ): Promise<BlackboardReadValueResponse> {
    try {
      return await this.handler.readValue(request);
    } catch (error: unknown) {
      throw mapBlackboardError(error, "Value could not be read");
    }
  }
}

/**
 * Connects (but does not start) the Blackboard gRPC microservice. Same
 * connect-only convention as the other Nodeexec/Compiler/Registry
 * transports -- the last transport connected in a multi-transport
 * bootstrap calls startAllMicroservices().
 */
export function connectBlackboardGrpcTransport(
  app: INestApplication,
  config: BlackboardGrpcTransportConfig,
): void {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.blackboard.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  });
}

function mapBlackboardError(error: unknown, fallbackMessage: string): RpcException {
  if (isNamedError(error, "BlackboardValidationError")) {
    return new RpcException({
      code: status.INVALID_ARGUMENT,
      message: error.message,
    });
  }
  if (isNamedError(error, "BlackboardRunNotFoundError")) {
    return new RpcException({
      code: status.NOT_FOUND,
      message: error.message,
    });
  }
  return internalError(error, fallbackMessage);
}

function isNamedError(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}
