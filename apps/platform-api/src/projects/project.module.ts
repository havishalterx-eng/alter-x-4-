import { Module } from "@nestjs/common";
import { EngineClient, EngineModule } from "../engine";
import { IdempotencyModule } from "../idempotency";
import { ProjectController } from "./project.controller";
import { ProjectExceptionFilter } from "./project-exception.filter";
import { ProjectService } from "./project.service";

@Module({
  imports: [EngineModule, IdempotencyModule],
  controllers: [ProjectController],
  providers: [
    {
      provide: ProjectService,
      inject: [EngineClient],
      useFactory: (engine: EngineClient) => new ProjectService(engine),
    },
    ProjectExceptionFilter,
  ],
})
export class ProjectModule {}
