import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { Pool } from "pg";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { StaffAuthMiddleware, StaffModule } from "../staff";
import { AdminTenantsController } from "./admin-tenants.controller";
import { AdminTenantsExceptionFilter } from "./admin-tenants-exception.filter";
import { AdminTenantsRepository } from "./admin-tenants.repository";
import { AdminTenantsService } from "./admin-tenants.service";

@Module({
  imports: [EntitlementsModule, StaffModule],
  controllers: [AdminTenantsController],
  providers: [
    {
      provide: AdminTenantsRepository,
      useFactory: () =>
        new AdminTenantsRepository(
          new Pool({ connectionString: process.env.DATABASE_URL }),
          true,
        ),
    },
    AdminTenantsService,
    AdminTenantsExceptionFilter,
  ],
})
export class AdminTenantsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(StaffAuthMiddleware).forRoutes(AdminTenantsController);
  }
}
