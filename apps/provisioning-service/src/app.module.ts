import { Module, type DynamicModule } from "@nestjs/common";
import type { SandboxProvider, SecretsProvider } from "@alterx/shared-clients";
import { HealthController } from "./health/health.controller";
import { ProvisioningService } from "./provisioning/provisioning.service";
@Module({}) export class AppModule { static register(sandbox: SandboxProvider, secrets: SecretsProvider): DynamicModule { return { module: AppModule, controllers: [HealthController], providers: [{ provide: ProvisioningService, useValue: new ProvisioningService(sandbox, secrets) }] }; } }
