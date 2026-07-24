import { Module, type DynamicModule } from "@nestjs/common";

import { MODELGW_HANDLER, ModelgwGrpcController } from "@alterx/adapters";
import type {
  CacheProvider,
  ConfigProvider,
  EmbeddingProvider,
  ModelProvider,
  PIIRedactionProvider,
  QueueProvider,
} from "@alterx/shared-clients";

import { ModelGatewayService } from "./gateway/model-gateway.service";
import { HealthController } from "./health/health.controller";

@Module({})
export class AppModule {
  static register(
    configProvider: ConfigProvider,
    modelProvider: ModelProvider,
    piiRedactionProvider: PIIRedactionProvider,
    embeddingProvider: EmbeddingProvider,
    cacheProvider: CacheProvider,
    queueProvider: QueueProvider,
    costEventsQueueName: string,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [ModelgwGrpcController, HealthController],
      providers: [
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
