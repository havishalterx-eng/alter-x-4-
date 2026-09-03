import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  RegistryGetNodeTypeRequest,
  RegistryGetNodeTypeResponse,
  RegistryListNodeTypesRequest,
  RegistryListNodeTypesResponse,
} from "@alterx/contracts";
import { internalError } from "./internal-error";

export const REGISTRY_HANDLER = Symbol("REGISTRY_HANDLER");

export interface RegistryHandler {
  listNodeTypes(
    request: RegistryListNodeTypesRequest,
  ): Promise<RegistryListNodeTypesResponse>;
  getNodeType(
    request: RegistryGetNodeTypeRequest,
  ): Promise<RegistryGetNodeTypeResponse>;
}

export interface RegistryGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class RegistryGrpcController {
  constructor(
    @Inject(REGISTRY_HANDLER)
    private readonly handler: RegistryHandler,
  ) {}

  @GrpcMethod("NodeTypeRegistryService", "ListNodeTypes")
  async listNodeTypes(
    request: RegistryListNodeTypesRequest,
  ): Promise<RegistryListNodeTypesResponse> {
    try {
      return await this.handler.listNodeTypes(request);
    } catch (error: unknown) {
      throw mapRegistryError(error, "Node types could not be listed");
    }
  }

  @GrpcMethod("NodeTypeRegistryService", "GetNodeType")
  async getNodeType(
    request: RegistryGetNodeTypeRequest,
  ): Promise<RegistryGetNodeTypeResponse> {
    try {
      return await this.handler.getNodeType(request);
    } catch (error: unknown) {
      throw mapRegistryError(error, "Node type could not be retrieved");
    }
  }
}

/**
 * Connects (but does not start) the Registry gRPC microservice. Same
 * connect-only convention as connectCompilerGrpcTransport -- the last
 * transport connected in a multi-transport bootstrap calls
 * startAllMicroservices(). See orchestration-service/src/main.ts.
 */
export function connectRegistryGrpcTransport(
  app: INestApplication,
  config: RegistryGrpcTransportConfig,
): void {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.registry.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  });
}

function mapRegistryError(error: unknown, fallbackMessage: string): RpcException {
  if (isNamedError(error, "RegistryValidationError")) {
    return new RpcException({
      code: status.INVALID_ARGUMENT,
      message: error.message,
    });
  }
  if (isNamedError(error, "RegistryNotFoundError")) {
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
