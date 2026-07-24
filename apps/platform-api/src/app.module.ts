import { Module } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { AbuseModule } from "./abuse/abuse.module";
import { EntitlementsModule } from "./entitlements/entitlements.module";
import { HealthController } from "./health/health.controller";
import { IdentityBrokerModule } from "./identity-broker/identity-broker.module";
import { IdentityModule } from "./identity/identity.module";
import { RbacModule } from "./rbac/rbac.module";

@Module({
  imports: [
    DbModule,
    IdentityModule,
    IdentityBrokerModule,
    RbacModule,
    EntitlementsModule,
    AbuseModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
