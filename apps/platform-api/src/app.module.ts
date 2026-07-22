import { Module } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { HealthController } from "./health/health.controller";
import { RbacModule } from "./rbac/rbac.module";

@Module({
  imports: [DbModule, RbacModule],
  controllers: [HealthController],
})
export class AppModule {}
