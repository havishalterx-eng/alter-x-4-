import { Module, type DynamicModule } from "@nestjs/common";

import { MODELGW_HANDLER, ModelgwGrpcController } from "@alterx/adapters";
import type {
  CacheProvider,
  EmbeddingProvider,
  PIIRedactionProvider,
  QueueProvider,
} from "@alterx/shared-clients";

import { ModelGatewayService } from "./gateway/model-gateway.service";
import { HealthController } from "./health/health.controller";
import {
  MODEL_GATEWAY_ADMIN_TOKEN,
  ModelGatewayOperationsController,
} from "./operations/model-gateway-operations.controller";
import { OperationalConfigProvider } from "./operations/operational-config-provider";
import { FailoverModelProvider } from "@alterx/adapters";

@Module({})
export class AppModule {
  static register(
    configProvider: OperationalConfigProvider,
    modelProvider: FailoverModelProvider,
    piiRedactionProvider: PIIRedactionProvider,
    embeddingProvider: EmbeddingProvider,
    cacheProvider: CacheProvider,
    queueProvider: QueueProvider,
    costEventsQueueName: string,
    adminServiceToken: string,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        ModelgwGrpcController,
        HealthController,
        ModelGatewayOperationsController,
      ],
      providers: [
        { provide: OperationalConfigProvider, useValue: configProvider },
        { provide: FailoverModelProvider, useValue: modelProvider },
        { provide: MODEL_GATEWAY_ADMIN_TOKEN, useValue: adminServiceToken },
        {
          provide: MODELGW_HANDLER,
          useValue: new ModelGatewayService(
            configProvider,
            modelProvider,
            piiRedactionProvider,
            embeddingProvider,
            cacheProvider,
            queueProvider,
            costEventsQueueName,
          ),
        },
      ],
    };
  }
}
