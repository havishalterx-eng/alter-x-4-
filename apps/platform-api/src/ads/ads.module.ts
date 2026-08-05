import { Module } from "@nestjs/common";
import { EngineClient, EngineModule } from "../engine";
import { IdempotencyModule } from "../idempotency";
import { AdsController } from "./ads.controller";
import { AdsExceptionFilter } from "./ads-exception.filter";
import { AdsService } from "./ads.service";

@Module({
  imports: [EngineModule, IdempotencyModule],
  controllers: [AdsController],
  providers: [
    {
      provide: AdsService,
      inject: [EngineClient],
      useFactory: (engine: EngineClient) => new AdsService(engine),
    },
    AdsExceptionFilter,
  ],
  exports: [AdsService],
})
export class AdsModule {}
