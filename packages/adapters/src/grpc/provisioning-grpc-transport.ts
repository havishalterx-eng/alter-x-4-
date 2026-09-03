import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  ProvisioningCloseCycleRequest,
  ProvisioningCloseCycleResponse,
  ProvisioningProvisionRequest,
  ProvisioningProvisionResponse,
} from "@alterx/contracts";
import { internalError } from "./internal-error";

export const PROVISIONING_HANDLER = Symbol("PROVISIONING_HANDLER");
export interface ProvisioningGrpcHandler {
  provision(request: ProvisioningProvisionRequest): Promise<ProvisioningProvisionResponse>;
  closeCycle(request: ProvisioningCloseCycleRequest): Promise<ProvisioningCloseCycleResponse>;
}

export interface ProvisioningGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class ProvisioningGrpcController {
  constructor(
    @Inject(PROVISIONING_HANDLER)
    private readonly handler: ProvisioningGrpcHandler,
  ) {}

  @GrpcMethod("ProvisioningService", "Provision")
  async provision(request: ProvisioningProvisionRequest): Promise<ProvisioningProvisionResponse> {
    try {
      return await this.handler.provision(request);
    } catch (error: unknown) {
      throw mapError(error);
    }
  }

  @GrpcMethod("ProvisioningService", "CloseCycle")
  async closeCycle(request: ProvisioningCloseCycleRequest): Promise<ProvisioningCloseCycleResponse> {
    try {
      return await this.handler.closeCycle(request);
    } catch (error: unknown) {
      throw mapError(error);
    }
  }
}

export async function startProvisioningGrpcTransport(
  app: INestApplication,
  config: ProvisioningGrpcTransportConfig,
): Promise<void> {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.provisioning.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  }, { inheritAppConfig: true });
  await app.startAllMicroservices();
}

function mapError(error: unknown): RpcException {
  if (
    error instanceof Error &&
    /required|identifier|relative|traverse/i.test(error.message)
  ) {
    return new RpcException({ code: status.INVALID_ARGUMENT, message: error.message });
  }
  return internalError(error, "Provisioning operation could not be completed");
}
