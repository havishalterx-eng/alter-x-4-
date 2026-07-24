import { Module, type DynamicModule } from "@nestjs/common";

import { TOOLGW_HANDLER, ToolgwGrpcController } from "@alterx/adapters";
import type { ConfigProvider, SecretsProvider } from "@alterx/shared-clients";

import { ToolGatewayService } from "./gateway/tool-gateway.service";
import { HealthController } from "./health/health.controller";

@Module({})
export class AppModule {
  static register(
    configProvider: ConfigProvider,
    secretsProvider: SecretsProvider,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [ToolgwGrpcController, HealthController],
      providers: [
        {
          provide: TOOLGW_HANDLER,
          useValue: new ToolGatewayService(configProvider, secretsProvider),
        },
      ],
    };
  }
}
