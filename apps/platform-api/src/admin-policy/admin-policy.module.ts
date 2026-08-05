import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { StaffAuthMiddleware, StaffModule } from "../staff";
import { AdminPolicyController } from "./admin-policy.controller";
import { AdminPolicyExceptionFilter } from "./admin-policy-exception.filter";
import { AdminPolicyService } from "./admin-policy.service";

@Module({
  imports: [EntitlementsModule, StaffModule],
  controllers: [AdminPolicyController],
  providers: [AdminPolicyService, AdminPolicyExceptionFilter],
})
export class AdminPolicyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(StaffAuthMiddleware).forRoutes(AdminPolicyController);
  }
}
