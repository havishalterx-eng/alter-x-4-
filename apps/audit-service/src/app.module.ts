import { Module, type DynamicModule } from "@nestjs/common";

import { AuditGrpcController } from "@alterx/adapters";
import {
  AUDIT_EVENT_HANDLER,
  AUDIT_STORE_PROVIDER,
  type AuditStoreProvider,
} from "@alterx/shared-clients";

import { AuditService } from "./audit/audit.service";
import { AuditStoreLifecycle } from "./database/store.lifecycle";
import { HealthController } from "./health/health.controller";

@Module({})
export class AppModule {
  static register(store: AuditStoreProvider): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuditGrpcController, HealthController],
      providers: [
        { provide: AUDIT_STORE_PROVIDER, useValue: store },
        AuditService,
        { provide: AUDIT_EVENT_HANDLER, useExisting: AuditService },
        AuditStoreLifecycle,
      ],
    };
  }
}
