import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { AdminAuditModule } from "../admin-audit";
import { EngineModule } from "../engine";
import { StaffAuthMiddleware, StaffModule } from "../staff";
import { AdminDeploymentController } from "./admin-deployment.controller";
import { AdminDeploymentService } from "./admin-deployment.service";

@Module({
  imports: [AdminAuditModule, EngineModule, StaffModule],
  controllers: [AdminDeploymentController],
  providers: [AdminDeploymentService],
})
export class AdminDeploymentModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(StaffAuthMiddleware).forRoutes(AdminDeploymentController);
  }
}
