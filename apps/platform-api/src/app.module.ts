import { Module } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { HealthController } from "./health/health.controller";
import { IdentityBrokerModule } from "./identity-broker/identity-broker.module";
import { IdentityModule } from "./identity/identity.module";
import { RbacModule } from "./rbac/rbac.module";

@Module({
  imports: [DbModule, IdentityModule, IdentityBrokerModule, RbacModule],
  controllers: [HealthController],
})
export class AppModule {}
