import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  ModelgwInvokeRequest,
  ModelgwInvokeResponse,
  ModelgwRedactRequest,
  ModelgwRedactResponse,
  ModelgwSelectFallbackResponse,
} from "@alterx/contracts";
import {
  InvalidModelAliasError,
  ModelAliasResolutionError,
} from "@alterx/shared-clients";

export const MODELGW_HANDLER = Symbol("MODELGW_HANDLER");

export interface ModelgwHandler {
  invoke(request: ModelgwInvokeRequest): Promise<ModelgwInvokeResponse>;
  redact(request: ModelgwRedactRequest): Promise<ModelgwRedactResponse>;
}

export interface ModelgwGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class ModelgwGrpcController {
  constructor(
    @Inject(MODELGW_HANDLER)
    private readonly handler: ModelgwHandler,
  ) {}

  @GrpcMethod("ModelgwService", "Invoke")
  async invoke(
    request: ModelgwInvokeRequest,
  ): Promise<ModelgwInvokeResponse> {
    try {
      return await this.handler.invoke(request);
    } catch (error: unknown) {
      if (
        error instanceof ModelAliasResolutionError ||
        error instanceof InvalidModelAliasError
      ) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: error.message,
        });
      }
      throw new RpcException({
        code: status.INTERNAL,
        message: "Model invocation could not be completed",
      });
    }
  }

  // Streaming responses are built in a later Gateways ticket; the RPC is
  // wired here so the full alter.modelgw.v1 service is served, but it is
  // not yet implemented.
  @GrpcMethod("ModelgwService", "Stream")
  stream(): never {
    throw new RpcException({
      code: status.UNIMPLEMENTED,
      message: "Streaming invocation ships in a later Gateways ticket",
    });
  }

  @GrpcMethod("ModelgwService", "Redact")
  async redact(
    request: ModelgwRedactRequest,
  ): Promise<ModelgwRedactResponse> {
    try {
      return await this.handler.redact(request);
    } catch {
      throw new RpcException({
        code: status.INTERNAL,
        message: "PII redaction could not be completed",
      });
    }
  }

  // Automatic fallback-chain selection is GATE-3.
  @GrpcMethod("ModelgwService", "SelectFallback")
  selectFallback(): ModelgwSelectFallbackResponse {
    throw new RpcException({
      code: status.UNIMPLEMENTED,
      message: "Fallback selection ships in GATE-3",
    });
  }
}

export async function startModelgwGrpcTransport(
  app: INestApplication,
  config: ModelgwGrpcTransportConfig,
): Promise<void> {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.modelgw.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  });
  await app.startAllMicroservices();
}
