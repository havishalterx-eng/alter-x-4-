import { Module } from "@nestjs/common";
import { EngineModule } from "../engine";
import { IdempotencyModule } from "../idempotency";
import { Pool } from "pg";
import { AnnotationController } from "./annotation.controller";
import { AnnotationRepository } from "./annotation.repository";
import {
  ActionQueueController,
  ApprovalActionController,
  ClarificationAssignmentController,
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
    ClarificationAssignmentController,
    EscalationActionController,
    RunClarificationActionController,
    AnnotationController,
  ],
  providers: [
    { provide: AnnotationRepository, useFactory: () => new AnnotationRepository(new Pool({ connectionString: process.env.DATABASE_URL }), true) },
    ActionCentreService, ActionCentreExceptionFilter,
  ],
  exports: [ActionCentreService],
})
export class ActionCentreModule {}
