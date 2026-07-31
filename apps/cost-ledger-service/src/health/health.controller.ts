import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";

import { COST_STORE_PROVIDER, type CostStoreProvider } from "../database/cost-store.token";

export interface CostLedgerHealthResponse {
  readonly status: "ok";
  readonly service: "cost-ledger-service";
}

@Controller("health")
export class HealthController {
  constructor(
    @Inject(COST_STORE_PROVIDER)
    private readonly store: CostStoreProvider,
  ) {}

  @Get()
  async getHealth(): Promise<CostLedgerHealthResponse> {
    try {
      const health = await this.store.healthCheck();
      if (health.status !== "healthy") {
        throw new Error("Cost store unhealthy");
      }
      return { status: "ok", service: "cost-ledger-service" };
    } catch {
      throw new ServiceUnavailableException("Cost ledger database is unavailable");
    }
  }
}
