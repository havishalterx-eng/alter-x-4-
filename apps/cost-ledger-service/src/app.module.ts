import { Module, type DynamicModule } from "@nestjs/common";

import {
  COST_HANDLER,
  type CostHandler,
  CostGrpcController,
  type RunsHandlerClient,
} from "@alterx/adapters";

import { COST_STORE_PROVIDER, type CostStoreProvider } from "./database/cost-store.token";
import { CostStoreLifecycle } from "./database/store.lifecycle";
import { CostIngestService, type CostEventStore } from "./ingest/cost-ingest.service";
import { CostRollupService, type RollupStore } from "./rollup/cost-rollup.service";
import { EstimationController } from "./estimation/estimation.controller";
import { EstimationService } from "./estimation/estimation.service";
import { HealthController } from "./health/health.controller";
import { NodeCostsController } from "./node-costs/node-costs.controller";
import { NodeCostsService } from "./node-costs/node-costs.service";

@Module({})
export class AppModule {
  static register(
    store: CostStoreProvider,
    runsClient: RunsHandlerClient,
    marginRate: number,
    pseudonymKey: string,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        CostGrpcController,
        HealthController,
        EstimationController,
        NodeCostsController,
      ],
      providers: [
        { provide: COST_STORE_PROVIDER, useValue: store },
        EstimationService,
        NodeCostsService,
        CostStoreLifecycle,
        {
          provide: COST_HANDLER,
          useFactory: (): CostHandler => {
            const ingest = new CostIngestService(store as unknown as CostEventStore, runsClient);
            const rollup = new CostRollupService(
              store as unknown as RollupStore,
              marginRate,
              pseudonymKey,
            );
            return {
              ingestCostEvent: (request) => ingest.ingestCostEvent(request),
              queryRollups: (request) => rollup.queryRollups(request),
            };
          },
        },
      ],
    };
  }
}
