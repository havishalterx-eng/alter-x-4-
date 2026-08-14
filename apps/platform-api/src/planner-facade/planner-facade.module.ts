import { Module } from "@nestjs/common";
import { PlannerFacadeService } from "./planner-facade.service";
import { PlannerFacadeController } from "./planner-facade.controller";
import { EngineModule } from "../engine/engine.module";
import { IdempotencyModule } from "../idempotency";

@Module({
  imports: [EngineModule, IdempotencyModule],
  providers: [PlannerFacadeService],
  controllers: [PlannerFacadeController],
})
export class PlannerFacadeModule {}
