import { Module } from "@nestjs/common";
import {
  ConcurrencyExceptionFilter,
  ETAG_RESOURCE_RESOLVER,
  EtagResponseInterceptor,
  IfMatchGuard,
} from "../concurrency";
import { EngineClient, EngineModule } from "../engine";
import { IdempotencyModule } from "../idempotency";
import { TriggerController } from "./trigger.controller";
import { TriggerEtagResolver } from "./trigger-etag.resolver";
import { TriggerExceptionFilter } from "./trigger-exception.filter";
import { TriggerService } from "./trigger.service";

@Module({
  imports: [EngineModule, IdempotencyModule],
  controllers: [TriggerController],
  providers: [
    {
      provide: TriggerService,
      inject: [EngineClient],
      useFactory: (engine: EngineClient) => new TriggerService(engine),
    },
    TriggerEtagResolver,
    {
      provide: ETAG_RESOURCE_RESOLVER,
      useExisting: TriggerEtagResolver,
    },
    IfMatchGuard,
    EtagResponseInterceptor,
    ConcurrencyExceptionFilter,
    TriggerExceptionFilter,
  ],
})
export class TriggerModule {}
