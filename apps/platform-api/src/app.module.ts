import { Module } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { AbuseModule } from "./abuse/abuse.module";
import { EntitlementsModule } from "./entitlements/entitlements.module";
import { HealthController } from "./health/health.controller";
import { IdentityBrokerModule } from "./identity-broker/identity-broker.module";
import { IdentityModule } from "./identity/identity.module";
import { RbacModule } from "./rbac/rbac.module";
import { MembersModule } from "./members/members.module";
import { SignupModule } from "./signup/signup.module";
import { TenantsModule } from "./tenants/tenants.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({
  imports: [
    DbModule,
    IdentityModule,
    IdentityBrokerModule,
    RbacModule,
    EntitlementsModule,
    AbuseModule,
    SignupModule,
    TenantsModule,
    WorkspacesModule,
    MembersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
