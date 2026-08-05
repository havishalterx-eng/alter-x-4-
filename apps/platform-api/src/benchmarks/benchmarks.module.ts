import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { EngineModule } from "../engine";
import { StaffAuthMiddleware, StaffModule } from "../staff";
import { BenchmarksController } from "./benchmarks.controller";
import { BenchmarksExceptionFilter } from "./benchmarks-exception.filter";
import { BenchmarksService } from "./benchmarks.service";

@Module({
  imports: [EngineModule, StaffModule],
  controllers: [BenchmarksController],
  providers: [BenchmarksService, BenchmarksExceptionFilter],
})
export class BenchmarksModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(StaffAuthMiddleware).forRoutes(BenchmarksController);
  }
}
