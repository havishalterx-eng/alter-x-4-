import { Module, type DynamicModule } from "@nestjs/common";

import { COST_STORE_PROVIDER, type CostStoreProvider } from "./database/cost-store.token";
import { CostStoreLifecycle } from "./database/store.lifecycle";
import { EstimationController } from "./estimation/estimation.controller";
import { EstimationService } from "./estimation/estimation.service";
import { HealthController } from "./health/health.controller";

@Module({})
export class AppModule {
  static register(store: CostStoreProvider): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, EstimationController],
      providers: [
        { provide: COST_STORE_PROVIDER, useValue: store },
        EstimationService,
        CostStoreLifecycle,
      ],
    };
  }
}
