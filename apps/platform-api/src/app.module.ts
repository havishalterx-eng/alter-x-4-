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
import { IntegrationModule } from "./integrations";
import { TriggerModule } from "./triggers";
import { BillingModule } from "./billing";
import { EnvVarModule } from "./env-vars";
import { CostsModule } from "./costs/costs.module";
import { WhatsappModule } from "./channels/whatsapp/whatsapp.module";
import { MarketplaceModule } from "./marketplace";
import { PublisherModule } from "./publisher";
import { I18nModule } from "./i18n/i18n.module";
import { RegistryModule } from "./registry";
import { NotificationModule } from "./notifications";
import { DiscoveryModule } from "./discovery/discovery.module";
import { SearchModule } from "./search";
import { StaffModule } from "./staff";
import { CliModule } from "./cli";
import { SystemHealthModule } from "./system-health/system-health.module";
import { AdminTenantsModule } from "./admin-tenants";
import { AdminPolicyModule } from "./admin-policy";
import { BenchmarksModule } from "./benchmarks";
import { AuditEventsModule } from "./audit-events";

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
    IntegrationModule,
    TriggerModule,
    BillingModule,
    CostsModule,
    EnvVarModule,
    WhatsappModule,
    MarketplaceModule,
    PublisherModule,
    I18nModule,
    RegistryModule,
    NotificationModule,
    DiscoveryModule,
    SearchModule,
    StaffModule,
    CliModule,
    SystemHealthModule,
    AdminTenantsModule,
    AdminPolicyModule,
    BenchmarksModule,
    AuditEventsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
