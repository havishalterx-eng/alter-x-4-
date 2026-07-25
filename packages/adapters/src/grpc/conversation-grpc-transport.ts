import { status } from "@grpc/grpc-js";
import { Controller, Inject, type INestApplication } from "@nestjs/common";
import {
  GrpcMethod,
  RpcException,
  Transport,
  type MicroserviceOptions,
} from "@nestjs/microservices";

import type {
  ConversationClassifyIntentRequest,
  ConversationClassifyIntentResponse,
  ConversationGetGoalStateRequest,
  ConversationGetGoalStateResponse,
  ConversationMergeClarificationRequest,
  ConversationMergeClarificationResponse,
} from "@alterx/contracts";

export const CONVERSATION_HANDLER = Symbol("CONVERSATION_HANDLER");

export interface ConversationHandler {
  classifyIntent(
    request: ConversationClassifyIntentRequest,
  ): Promise<ConversationClassifyIntentResponse>;
  getGoalState(
    request: ConversationGetGoalStateRequest,
  ): Promise<ConversationGetGoalStateResponse>;
  mergeClarification(
    request: ConversationMergeClarificationRequest,
  ): Promise<ConversationMergeClarificationResponse>;
}

export interface ConversationGrpcTransportConfig {
  readonly bindAddress: string;
  readonly protoPath: string;
}

@Controller()
export class ConversationGrpcController {
  constructor(
    @Inject(CONVERSATION_HANDLER)
    private readonly handler: ConversationHandler,
  ) {}

  @GrpcMethod("ConversationService", "ClassifyIntent")
  async classifyIntent(
    request: ConversationClassifyIntentRequest,
  ): Promise<ConversationClassifyIntentResponse> {
    try {
      return await this.handler.classifyIntent(request);
    } catch (error: unknown) {
      throw mapConversationError(error, "Intent classification could not be completed");
    }
  }

  @GrpcMethod("ConversationService", "GetGoalState")
  async getGoalState(
    request: ConversationGetGoalStateRequest,
  ): Promise<ConversationGetGoalStateResponse> {
    try {
      return await this.handler.getGoalState(request);
    } catch (error: unknown) {
      throw mapConversationError(error, "Goal state could not be retrieved");
    }
  }

  @GrpcMethod("ConversationService", "MergeClarification")
  async mergeClarification(
    request: ConversationMergeClarificationRequest,
  ): Promise<ConversationMergeClarificationResponse> {
    try {
      return await this.handler.mergeClarification(request);
    } catch (error: unknown) {
      throw mapConversationError(error, "Clarification could not be merged");
    }
  }
}

export async function startConversationGrpcTransport(
  app: INestApplication,
  config: ConversationGrpcTransportConfig,
): Promise<void> {
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: "alter.conversation.v1",
      protoPath: config.protoPath,
      url: config.bindAddress,
      loader: { keepCase: true },
    },
  });
  await app.startAllMicroservices();
}

function mapConversationError(
  error: unknown,
  fallbackMessage: string,
): RpcException {
  if (isNamedError(error, "ConversationValidationError")) {
    return new RpcException({
      code: status.INVALID_ARGUMENT,
      message: error.message,
    });
  }
  if (isNamedError(error, "ConversationConcurrencyError")) {
    return new RpcException({
      code: status.ABORTED,
      message: error.message,
    });
  }
  if (isNamedError(error, "ConversationClassificationError")) {
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
