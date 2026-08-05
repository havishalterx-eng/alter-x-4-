import {
  credentials,
  loadPackageDefinition,
  type Client,
  type ServiceClientConstructor,
  type ServiceError,
} from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

import type {
  ConversationClassifyIntentRequest,
  ConversationClassifyIntentResponse,
} from "@alterx/contracts";

interface ConversationGrpcClient extends Client {
  classifyIntent(
    request: ConversationClassifyIntentRequest,
    callback: (
      error: ServiceError | null,
      response: ConversationClassifyIntentResponse,
    ) => void,
  ): void;
}

interface ConversationPackageDefinition {
  readonly alter: {
    readonly conversation: {
      readonly v1: {
        readonly ConversationService: ServiceClientConstructor;
      };
    };
  };
}

export interface ConversationGrpcTestHarness {
  classifyIntent(
    request: ConversationClassifyIntentRequest,
  ): Promise<ConversationClassifyIntentResponse>;
  teardown(): void;
}

/**
 * Real gRPC client wrapper for Engine-app integration tests. Vendor SDK
 * imports remain confined to packages/adapters while app tests still cross
 * the actual protobuf transport boundary.
 */
export function createConversationGrpcTestHarness(
  address: string,
  protoPath: string,
): ConversationGrpcTestHarness {
  const loaded = loadPackageDefinition(
    loadSync(protoPath, { keepCase: true }),
  ) as unknown as ConversationPackageDefinition;
  const client = new loaded.alter.conversation.v1.ConversationService(
    address,
    credentials.createInsecure(),
  ) as unknown as ConversationGrpcClient;

  return {
    classifyIntent(request) {
      return new Promise((resolve, reject) => {
        client.classifyIntent(request, (error, response) => {
          if (error === null) {
            resolve(response);
          } else {
            reject(error);
          }
        });
      });
    },
    teardown() {
      client.close();
    },
  };
}
