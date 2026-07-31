import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  CostIngestCostEventRequest,
  CostIngestCostEventResponse,
} from "@alterx/contracts";

export const COST_HANDLER = Symbol("COST_HANDLER");

/**
 * QueryRollups is declared in cost.proto but has no handler here -- that's
 * OUT-5's scope (Cost Ledger economics/rollups), not OUT-4's ingestion.
 * grpc-js returns UNIMPLEMENTED automatically for a proto-declared method
 * with no registered @GrpcMethod handler; same pattern as this codebase's
 * other stub-until-a-later-phase RPCs.
 */
export interface CostHandler {
  ingestCostEvent(
    request: CostIngestCostEventRequest,
  ): Promise<CostIngestCostEventResponse>;
}

export interface CostGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class CostGrpcController {
  constructor(@Inject(COST_HANDLER) private readonly handler: CostHandler) {}

  @GrpcMethod("CostService", "IngestCostEvent")
  async ingestCostEvent(
    request: CostIngestCostEventRequest,
  ): Promise<CostIngestCostEventResponse> {
    try {
      return await this.handler.ingestCostEvent(request);
    } catch (error: unknown) {
      throw mapCostError(error);
    }
  }
}

/** Cost Ledger is single-transport, so this starts the microservice itself
 * (matches ModelGw's startModelgwGrpcTransport, not orchestration-service's
 * multi-transport connect-then-start-once pattern). */
export async function startCostGrpcTransport(
  app: INestApplication,
  config: CostGrpcTransportConfig,
): Promise<void> {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.cost.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  });
  await app.startAllMicroservices();
}

function mapCostError(error: unknown): RpcException {
  if (isNamedError(error, "CostValidationError")) {
    return new RpcException({
      code: status.INVALID_ARGUMENT,
      message: error.message,
    });
  }
  if (isNamedError(error, "CostUnrecognizedSourceError")) {
    return new RpcException({
      code: status.INVALID_ARGUMENT,
      message: error.message,
    });
  }
  return new RpcException({
    code: status.INTERNAL,
    message: "Cost event ingestion could not be completed",
  });
}

function isNamedError(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}
