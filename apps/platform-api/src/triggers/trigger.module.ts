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
import { TriggerBindingController } from "./trigger-binding.controller";
import { TriggerBindingService } from "./trigger-binding.service";
import { TriggerEtagResolver } from "./trigger-etag.resolver";
import { TriggerExceptionFilter } from "./trigger-exception.filter";
import { TriggerService } from "./trigger.service";

@Module({
  imports: [EngineModule, IdempotencyModule],
  controllers: [TriggerController, TriggerBindingController],
  providers: [
    {
      provide: TriggerService,
      inject: [EngineClient],
      useFactory: (engine: EngineClient) => new TriggerService(engine),
    },
    {
      provide: TriggerBindingService,
      inject: [EngineClient],
      useFactory: (engine: EngineClient) => new TriggerBindingService(engine),
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
