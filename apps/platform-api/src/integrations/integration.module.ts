import { Module } from "@nestjs/common";
import { EngineClient, EngineModule } from "../engine";
import { IdempotencyModule } from "../idempotency";
import { IntegrationController } from "./integration.controller";
import { IntegrationExceptionFilter } from "./integration-exception.filter";
import { IntegrationService } from "./integration.service";

@Module({
  imports: [EngineModule, IdempotencyModule],
  controllers: [IntegrationController],
  providers: [
    {
      provide: IntegrationService,
      inject: [EngineClient],
      useFactory: (engine: EngineClient) => new IntegrationService(engine),
    },
    IntegrationExceptionFilter,
  ],
})
export class IntegrationModule {}
