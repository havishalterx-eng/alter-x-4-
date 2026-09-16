import { Module } from "@nestjs/common";
import type { AuditEventHandler } from "@alterx/shared-clients";
import { engineAuditClientFromEnvironment } from "../audit/engine-audit-client";
import { SignupModule } from "../signup/signup.module";
import { PlatformDb } from "../signup/platform-db";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";

const TENANT_AUDIT_CLIENT = Symbol("TENANT_AUDIT_CLIENT");

@Module({
  imports: [SignupModule],
  controllers: [TenantsController],
  providers: [
    { provide: TENANT_AUDIT_CLIENT, useFactory: engineAuditClientFromEnvironment },
    {
      provide: TenantsService,
      inject: [PlatformDb, TENANT_AUDIT_CLIENT],
      useFactory: (db: PlatformDb, audit: AuditEventHandler) => new TenantsService(db, audit),
    },
  ],
})
export class TenantsModule {}
