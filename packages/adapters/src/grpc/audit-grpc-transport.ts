import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  RecordEventRequest,
  RecordEventResponse,
} from "@alterx/contracts";
import {
  AUDIT_EVENT_HANDLER,
  AuditValidationError,
  type AuditEventHandler,
} from "@alterx/shared-clients";

export interface AuditGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class AuditGrpcController {
  constructor(
    @Inject(AUDIT_EVENT_HANDLER)
    private readonly handler: AuditEventHandler,
  ) {}

  @GrpcMethod("AuditService", "RecordEvent")
  async recordEvent(request: RecordEventRequest): Promise<RecordEventResponse> {
    try {
      return await this.handler.recordEvent(request);
    } catch (error: unknown) {
      if (error instanceof AuditValidationError) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: error.message,
        });
      }
      throw new RpcException({
        code: status.INTERNAL,
        message: "Audit event could not be recorded",
      });
    }
  }
}

export async function startAuditGrpcTransport(
  app: INestApplication,
  config: AuditGrpcTransportConfig,
): Promise<void> {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.audit.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  });
  await app.startAllMicroservices();
}
