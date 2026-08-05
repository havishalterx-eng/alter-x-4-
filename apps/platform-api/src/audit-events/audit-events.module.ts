import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { EngineModule } from "../engine";
import { StaffAuthMiddleware, StaffModule } from "../staff";
import { AuditEventsController } from "./audit-events.controller";
import { AuditEventsExceptionFilter } from "./audit-events-exception.filter";
import { AuditEventsService } from "./audit-events.service";

@Module({
  imports: [EngineModule, StaffModule],
  controllers: [AuditEventsController],
  providers: [AuditEventsService, AuditEventsExceptionFilter],
})
export class AuditEventsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(StaffAuthMiddleware).forRoutes(AuditEventsController);
  }
}
