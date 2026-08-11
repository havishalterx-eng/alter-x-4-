import { Module, type DynamicModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { SandboxProvider } from "@alterx/shared-clients";
import {
  SANDBOX_HANDLER,
  SandboxGrpcController,
  type ArtifactContentClientHandler,
} from "@alterx/adapters";
import { M2mValidator, ServiceAuthGuard } from "@alterx/auth";

import { HealthController } from "./health/health.controller";
import { SandboxServiceGrpcHandler } from "./sandbox/sandbox.grpc-handler";
import {
  SandboxService,
  type SandboxToolDependencies,
} from "./sandbox/sandbox.service";

@Module({ controllers: [HealthController] })
export class AppModule {
  static register(
    sandbox: SandboxProvider,
    artifacts: ArtifactContentClientHandler,
    tools?: SandboxToolDependencies,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [SandboxGrpcController],
      providers: [
        serviceAuthGuardProvider(),
        { provide: SandboxService, useValue: new SandboxService(sandbox, tools) },
        {
          provide: SANDBOX_HANDLER,
          useFactory: (service: SandboxService) =>
            new SandboxServiceGrpcHandler(service, artifacts),
          inject: [SandboxService],
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
