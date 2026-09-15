import { Module } from "@nestjs/common";
import { PlannerFacadeService } from "./planner-facade.service";
import { PlannerFacadeController } from "./planner-facade.controller";
import { EngineModule } from "../engine/engine.module";
import { IdempotencyModule } from "../idempotency";
import { sharedPool } from "../db/shared-pool";
import { TenantResidencyRepository } from "./tenant-residency.repository";

@Module({
  imports: [EngineModule, IdempotencyModule],
  providers: [
    PlannerFacadeService,
    {
      provide: TenantResidencyRepository,
      useFactory: () => new TenantResidencyRepository(sharedPool(process.env.DATABASE_URL)),
    },
  ],
  controllers: [PlannerFacadeController],
})
export class PlannerFacadeModule {}
