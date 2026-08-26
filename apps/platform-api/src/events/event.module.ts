import { Module } from "@nestjs/common";
import { EngineModule } from "../engine";
import { EventController } from "./event.controller";
import { EventExceptionFilter } from "./event-exception.filter";
import { EventService } from "./event.service";

@Module({
  imports: [EngineModule],
  controllers: [EventController],
  providers: [EventService, EventExceptionFilter],
  exports: [EventService],
})
export class EventModule {}
