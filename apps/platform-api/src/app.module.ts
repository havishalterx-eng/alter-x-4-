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
import { OnboardingModule } from "./onboarding/onboarding.module";
import { EngineModule } from "./engine/engine.module";
import { IdempotencyModule } from "./idempotency/idempotency.module";
import { StreamingModule } from "./streaming/streaming.module";
import { WorkflowModule } from "./workflows/workflow.module";
import { ProjectModule } from "./projects/project.module";
import { RunModule } from "./runs/run.module";
import { ActionCentreModule } from "./action-centre/action-centre.module";
import { CredentialModule } from "./credentials";
import { AdsModule } from "./ads";

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
    OnboardingModule,
    EngineModule,
    IdempotencyModule,
    StreamingModule,
    WorkflowModule,
    ProjectModule,
    RunModule,
    ActionCentreModule,
    CredentialModule,
    AdsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
