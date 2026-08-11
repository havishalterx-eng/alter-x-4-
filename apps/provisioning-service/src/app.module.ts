import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { PROVISIONING_HANDLER, ProvisioningGrpcController } from "@alterx/adapters";
import { M2mValidator, ServiceAuthGuard } from "@alterx/auth";
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
        serviceAuthGuardProvider(),
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

function serviceAuthGuardProvider() {
  return {
    provide: APP_GUARD,
    useFactory: () =>
      new ServiceAuthGuard(
        new M2mValidator({
          auth0Domain: process.env["AUTH0_DOMAIN"] ?? "",
          apiAudience: process.env["API_AUDIENCE"] ?? "",
          ...(process.env["AUTH0_JWKS_URL"] === undefined
            ? {}
            : { jwksUrl: process.env["AUTH0_JWKS_URL"] }),
        }),
      ),
  };
}
