import { Module, type DynamicModule } from "@nestjs/common";
import type { SandboxProvider } from "@alterx/shared-clients";
import {
  SANDBOX_HANDLER,
  SandboxGrpcController,
} from "@alterx/adapters";

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
    tools?: SandboxToolDependencies,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [SandboxGrpcController],
      providers: [
        { provide: SandboxService, useValue: new SandboxService(sandbox, tools) },
        {
          provide: SANDBOX_HANDLER,
          useFactory: (service: SandboxService) =>
            new SandboxServiceGrpcHandler(service),
          inject: [SandboxService],
        },
      ],
    };
  }
}
