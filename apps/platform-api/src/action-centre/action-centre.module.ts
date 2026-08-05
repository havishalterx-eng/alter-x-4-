import { Module } from "@nestjs/common";
import { EngineModule } from "../engine";
import { IdempotencyModule } from "../idempotency";
import {
  ActionQueueController,
  ApprovalActionController,
  EscalationActionController,
  RunClarificationActionController,
} from "./action-centre.controller";
import { ActionCentreExceptionFilter } from "./action-centre-exception.filter";
import { ActionCentreService } from "./action-centre.service";

@Module({
  imports: [EngineModule, IdempotencyModule],
  controllers: [
    ActionQueueController,
    ApprovalActionController,
    EscalationActionController,
    RunClarificationActionController,
  ],
  providers: [ActionCentreService, ActionCentreExceptionFilter],
  exports: [ActionCentreService],
})
export class ActionCentreModule {}
