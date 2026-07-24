import { Module, type DynamicModule } from "@nestjs/common";

import { MODELGW_HANDLER, ModelgwGrpcController } from "@alterx/adapters";
import type {
  ConfigProvider,
  ModelProvider,
  PIIRedactionProvider,
} from "@alterx/shared-clients";

import { ModelGatewayService } from "./gateway/model-gateway.service";
import { HealthController } from "./health/health.controller";

@Module({})
export class AppModule {
  static register(
    configProvider: ConfigProvider,
    modelProvider: ModelProvider,
    piiRedactionProvider: PIIRedactionProvider,
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
          ),
        },
      ],
    };
  }
}
