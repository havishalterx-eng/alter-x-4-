import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  GetEventRequest,
  GetEventResponse,
  RecordEventRequest,
  RecordEventResponse,
} from "@alterx/contracts";
import {
  AUDIT_EVENT_HANDLER,
  AuditEventNotFoundError,
  AuditValidationError,
  type AuditEventHandler,
} from "@alterx/shared-clients";
import { internalError } from "./internal-error";

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
      throw internalError(error, "Audit event could not be recorded");
    }
  }

  @GrpcMethod("AuditService", "GetEvent")
  async getEvent(request: GetEventRequest): Promise<GetEventResponse> {
    try {
      return await this.handler.getEvent(request);
    } catch (error: unknown) {
      if (error instanceof AuditEventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      throw internalError(error, "Audit event could not be retrieved");
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
      // defaults: true is required here (unlike every other transport in
      // this file's own directory) because a real proto3-compliant caller
      // correctly omits default-valued scalar fields on the wire (e.g. an
      // empty string) -- without this, @grpc/proto-loader's dynamic
      // decode leaves those fields `undefined` instead of backfilling
      // the real proto3 default, which crashes AuditService's own real
      // validateRequest() the moment any optional string field is
      // omitted by a spec-correct client (first hit by a real Python
      // caller; every other transport here has so far only been
      // exercised by JS/TS callers built via @grpc/proto-loader's own
      // equally loose dynamic message construction, which happens to
      // paper over the same real gap).
      loader: { keepCase: true, defaults: true },
    },
  }, { inheritAppConfig: true });
  await app.startAllMicroservices();
}
