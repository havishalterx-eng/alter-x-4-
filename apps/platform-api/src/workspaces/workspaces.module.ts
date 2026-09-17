import { Module } from "@nestjs/common";
import type { AuditEventHandler } from "@alterx/shared-clients";
import { engineAuditClientFromEnvironment } from "../audit/engine-audit-client";
import { PlatformDb } from "../signup/platform-db";
import { SignupModule } from "../signup/signup.module";
import { WorkspaceSafeguardsService } from "./workspace-safeguards.service";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

const WORKSPACE_AUDIT_CLIENT = Symbol("WORKSPACE_AUDIT_CLIENT");

@Module({
  imports: [SignupModule],
  controllers: [WorkspacesController],
  providers: [
    {
      provide: WorkspacesService,
      inject: [PlatformDb],
      useFactory: (db: PlatformDb) => new WorkspacesService(db),
    },
    { provide: WORKSPACE_AUDIT_CLIENT, useFactory: engineAuditClientFromEnvironment },
    {
      provide: WorkspaceSafeguardsService,
      inject: [PlatformDb, WORKSPACE_AUDIT_CLIENT],
      useFactory: (db: PlatformDb, audit: AuditEventHandler) =>
        new WorkspaceSafeguardsService(db, audit),
    },
  ],
})
export class WorkspacesModule {}
