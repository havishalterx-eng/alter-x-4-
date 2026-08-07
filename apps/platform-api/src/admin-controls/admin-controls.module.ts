import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { AwsSecretsManagerProvider } from "@alterx/adapters";
import type { SecretsProvider } from "@alterx/shared-clients";
import { Pool } from "pg";
import { AdminAuditModule } from "../admin-audit";
import { StaffAuthMiddleware, StaffModule } from "../staff";
import { AdminControlsController } from "./admin-controls.controller";
import { AdminControlsExceptionFilter } from "./admin-controls-exception.filter";
import { AdminControlsService } from "./admin-controls.service";
import { FeatureFlagRepository } from "./feature-flag.repository";
import { ModelGatewayAdminClient } from "./model-gateway-admin.client";

const MODEL_GATEWAY_SECRETS = Symbol("MODEL_GATEWAY_SECRETS");

@Module({
  imports: [AdminAuditModule, StaffModule],
  controllers: [AdminControlsController],
  providers: [
    {
      provide: FeatureFlagRepository,
      useFactory: () => new FeatureFlagRepository(
        new Pool({ connectionString: process.env.DATABASE_URL }),
        true,
      ),
    },
    {
      provide: MODEL_GATEWAY_SECRETS,
      useFactory: () => new AwsSecretsManagerProvider({
        region: process.env.AWS_REGION ?? "ap-south-1",
      }),
    },
    {
      provide: ModelGatewayAdminClient,
      inject: [MODEL_GATEWAY_SECRETS],
      useFactory: (secrets: SecretsProvider) => new ModelGatewayAdminClient({
        ...(process.env.MODEL_GATEWAY_ADMIN_BASE_URL === undefined
          ? {}
          : { baseUrl: process.env.MODEL_GATEWAY_ADMIN_BASE_URL }),
        ...(process.env.MODEL_GATEWAY_ADMIN_TOKEN_REF === undefined
          ? {}
          : { tokenSecretRef: process.env.MODEL_GATEWAY_ADMIN_TOKEN_REF }),
        timeoutMs: Number(process.env.MODEL_GATEWAY_ADMIN_TIMEOUT_MS ?? "5000"),
      }, secrets),
    },
    AdminControlsService,
    AdminControlsExceptionFilter,
  ],
})
export class AdminControlsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(StaffAuthMiddleware).forRoutes(AdminControlsController);
  }
}
