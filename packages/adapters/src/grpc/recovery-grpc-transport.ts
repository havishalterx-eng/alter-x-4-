import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  RecoveryClassifyFailureRequest,
  RecoveryClassifyFailureResponse,
  RecoveryRecordOutcomeRequest,
  RecoveryRecordOutcomeResponse,
  RecoverySelectStrategyRequest,
  RecoverySelectStrategyResponse,
} from "@alterx/contracts";
import { internalError } from "./internal-error";

export const RECOVERY_HANDLER = Symbol("RECOVERY_HANDLER");

export interface RecoveryHandler {
  classifyFailure(
    request: RecoveryClassifyFailureRequest,
  ): Promise<RecoveryClassifyFailureResponse>;
  selectStrategy(
    request: RecoverySelectStrategyRequest,
  ): Promise<RecoverySelectStrategyResponse>;
  recordOutcome(
    request: RecoveryRecordOutcomeRequest,
  ): Promise<RecoveryRecordOutcomeResponse>;
}

export interface RecoveryGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class RecoveryGrpcController {
  constructor(
    @Inject(RECOVERY_HANDLER) private readonly handler: RecoveryHandler,
  ) {}

  @GrpcMethod("RecoveryService", "ClassifyFailure")
  async classifyFailure(
    request: RecoveryClassifyFailureRequest,
  ): Promise<RecoveryClassifyFailureResponse> {
    try {
      return await this.handler.classifyFailure(request);
    } catch (error: unknown) {
      throw mapRecoveryError(error);
    }
  }

  @GrpcMethod("RecoveryService", "SelectStrategy")
  async selectStrategy(
    request: RecoverySelectStrategyRequest,
  ): Promise<RecoverySelectStrategyResponse> {
    try {
      return await this.handler.selectStrategy(request);
    } catch (error: unknown) {
      throw mapRecoveryError(error);
    }
  }

  @GrpcMethod("RecoveryService", "RecordOutcome")
  async recordOutcome(
    request: RecoveryRecordOutcomeRequest,
  ): Promise<RecoveryRecordOutcomeResponse> {
    try {
      return await this.handler.recordOutcome(request);
    } catch (error: unknown) {
      throw mapRecoveryError(error);
    }
  }
}

/** Connect-only: orchestration bootstrap starts all transports once. */
export function connectRecoveryGrpcTransport(
  app: INestApplication,
  config: RecoveryGrpcTransportConfig,
): void {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.recovery.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  });
}

function mapRecoveryError(error: unknown): RpcException {
  if (isNamedError(error, "RecoveryValidationError")) {
    return new RpcException({
      code: status.INVALID_ARGUMENT,
      message: error.message,
    });
  }
  if (isNamedError(error, "RecoveryNodeNotFoundError")) {
    return new RpcException({
      code: status.FAILED_PRECONDITION,
      message: error.message,
    });
  }
  if (isNamedError(error, "RecoveryRootCauseUnavailableError")) {
    return new RpcException({
      code: status.UNAVAILABLE,
      message: "Root-cause classifier is unavailable",
    });
  }
  if (isNamedError(error, "RecoveryPersistenceConflictError")) {
    return new RpcException({
      code: status.ABORTED,
      message: "Recovery classification persistence conflicted",
    });
  }
  if (isNamedError(error, "RecoveryActionNotClassifiedError")) {
    return new RpcException({
      code: status.FAILED_PRECONDITION,
      message: error.message,
    });
  }
  if (isNamedError(error, "RecoveryActionNotFoundError")) {
    return new RpcException({
      code: status.NOT_FOUND,
      message: error.message,
    });
  }
  return internalError(error, "Failure classification could not be completed");
}

function isNamedError(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}
