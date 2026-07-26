import { Module } from "@nestjs/common";
import { EngineClient, EngineModule } from "../engine";
import { IdempotencyModule } from "../idempotency";
import { ProjectOperationsController } from "./project-operations.controller";
import { ProjectOperationsService } from "./project-operations.service";
import { ProjectController } from "./project.controller";
import { ProjectExceptionFilter } from "./project-exception.filter";
import { ProjectService } from "./project.service";

@Module({
  imports: [EngineModule, IdempotencyModule],
  controllers: [ProjectController, ProjectOperationsController],
  providers: [
    {
      provide: ProjectService,
      inject: [EngineClient],
      useFactory: (engine: EngineClient) => new ProjectService(engine),
    },
    {
      provide: ProjectOperationsService,
      inject: [EngineClient],
      useFactory: (engine: EngineClient) =>
        new ProjectOperationsService(engine),
    },
    ProjectExceptionFilter,
  ],
})
export class ProjectModule {}
