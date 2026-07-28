import { Module, type DynamicModule } from "@nestjs/common";
import type { SandboxProvider } from "@alterx/shared-clients";
import { HealthController } from "./health/health.controller";
import { SandboxService } from "./sandbox/sandbox.service";

@Module({ controllers: [HealthController] })
export class AppModule {
  static register(sandbox: SandboxProvider): DynamicModule {
    return {
      module: AppModule,
      providers: [{ provide: SandboxService, useValue: new SandboxService(sandbox) }],
    };
  }
}
