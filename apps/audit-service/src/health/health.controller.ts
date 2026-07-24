import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  AUDIT_STORE_PROVIDER,
  type AuditStoreProvider,
} from "@alterx/shared-clients";

export interface AuditHealthResponse {
  readonly status: "ok";
  readonly service: "audit-service";
}

@Controller("health")
export class HealthController {
  constructor(
    @Inject(AUDIT_STORE_PROVIDER)
    private readonly store: AuditStoreProvider,
  ) {}

  @Get()
  async getHealth(): Promise<AuditHealthResponse> {
    try {
      const health = await this.store.healthCheck();
      if (health.status !== "healthy") {
        throw new Error("Audit store unhealthy");
      }
      return { status: "ok", service: "audit-service" };
    } catch {
      throw new ServiceUnavailableException("Audit database is unavailable");
    }
  }
}
