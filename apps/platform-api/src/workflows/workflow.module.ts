import { Module } from "@nestjs/common";
import {
  ConcurrencyExceptionFilter,
  ETAG_RESOURCE_RESOLVER,
  EtagResponseInterceptor,
  IfMatchGuard,
} from "../concurrency";
import { EngineModule } from "../engine";
import { IdempotencyModule } from "../idempotency";
import { WorkflowController } from "./workflow.controller";
import { WorkflowEtagResolver } from "./workflow-etag.resolver";
import { WorkflowExceptionFilter } from "./workflow-exception.filter";
import { WorkflowService } from "./workflow.service";

@Module({
  imports: [EngineModule, IdempotencyModule],
  controllers: [WorkflowController],
  providers: [
    WorkflowService,
    WorkflowEtagResolver,
    {
      provide: ETAG_RESOURCE_RESOLVER,
      useExisting: WorkflowEtagResolver,
    },
    IfMatchGuard,
    EtagResponseInterceptor,
    ConcurrencyExceptionFilter,
    WorkflowExceptionFilter,
  ],
  exports: [WorkflowService],
})
export class WorkflowModule {}
