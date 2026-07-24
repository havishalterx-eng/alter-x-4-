import { Module, type DynamicModule } from "@nestjs/common";

import { MODELGW_HANDLER, ModelgwGrpcController } from "@alterx/adapters";
import type { ConfigProvider, ModelProvider } from "@alterx/shared-clients";

import { ModelGatewayService } from "./gateway/model-gateway.service";
import { HealthController } from "./health/health.controller";

@Module({})
export class AppModule {
  static register(
    configProvider: ConfigProvider,
    modelProvider: ModelProvider,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [ModelgwGrpcController, HealthController],
      providers: [
        {
          provide: MODELGW_HANDLER,
          useValue: new ModelGatewayService(configProvider, modelProvider),
        },
      ],
    };
  }
}
