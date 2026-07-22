import { Module } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { HealthController } from "./health/health.controller";
import { IdentityModule } from "./identity/identity.module";
import { RbacModule } from "./rbac/rbac.module";

@Module({
  imports: [DbModule, IdentityModule, RbacModule],
  controllers: [HealthController],
})
export class AppModule {}
