import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import {
  AtlassianStatusPageProvider,
  AwsSecretsManagerProvider,
} from "@alterx/adapters";
import {
  createMockStatusPageProvider,
  type SecretsProvider,
} from "@alterx/shared-clients";
import { Pool } from "pg";
import { AdminAuditModule } from "../admin-audit";
import { StaffAuthMiddleware, StaffModule } from "../staff";
import { IncidentController } from "./incident.controller";
import { IncidentExceptionFilter } from "./incident-exception.filter";
import { IncidentRepository } from "./incident.repository";
import { IncidentService } from "./incident.service";
import { STATUS_PAGE_PROVIDER, STATUS_PAGE_SECRETS_PROVIDER } from "./tokens";

@Module({
  imports: [AdminAuditModule, StaffModule],
  controllers: [IncidentController],
  providers: [
    {
      provide: IncidentRepository,
      useFactory: () => new IncidentRepository(
        new Pool({ connectionString: process.env.DATABASE_URL }),
        true,
      ),
    },
    {
      provide: STATUS_PAGE_SECRETS_PROVIDER,
      useFactory: () => new AwsSecretsManagerProvider({
        region: process.env.AWS_REGION ?? "ap-south-1",
      }),
    },
    {
      provide: STATUS_PAGE_PROVIDER,
      inject: [STATUS_PAGE_SECRETS_PROVIDER],
      useFactory: (secrets: SecretsProvider) =>
        process.env.STATUS_PAGE_PROVIDER === "atlassian"
          ? new AtlassianStatusPageProvider({
              pageId: process.env.STATUSPAGE_PAGE_ID!,
              apiTokenSecretRef: process.env.STATUSPAGE_API_TOKEN_SECRET_REF!,
            }, secrets)
          : createMockStatusPageProvider(),
    },
    IncidentService,
    IncidentExceptionFilter,
  ],
})
export class IncidentModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(StaffAuthMiddleware).forRoutes(IncidentController);
  }
}
