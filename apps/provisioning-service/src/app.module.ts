import { type DynamicModule, Module } from "@nestjs/common";

import { PROVISIONING_HANDLER, ProvisioningGrpcController } from "@alterx/adapters";
import type { SandboxProvider, SecretsProvider } from "@alterx/shared-clients";

import { HealthController } from "./health/health.controller";
import { ProvisioningServiceGrpcHandler } from "./provisioning/provisioning.grpc-handler";
import { ProvisioningService } from "./provisioning/provisioning.service";

@Module({})
export class AppModule {
  static register(
    sandbox: SandboxProvider,
    secrets: SecretsProvider,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, ProvisioningGrpcController],
      providers: [
        {
          provide: ProvisioningService,
          useValue: new ProvisioningService(sandbox, secrets),
        },
        {
          provide: PROVISIONING_HANDLER,
          useFactory: (service: ProvisioningService) =>
            new ProvisioningServiceGrpcHandler(service),
          inject: [ProvisioningService],
        },
      ],
    };
  }
}
