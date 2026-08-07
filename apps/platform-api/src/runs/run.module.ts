import { Module } from "@nestjs/common";
import { EngineModule } from "../engine";
import { IdempotencyModule } from "../idempotency";
import { ArtifactController, RunController } from "./run.controller";
import { RunExceptionFilter } from "./run-exception.filter";
import { RunService } from "./run.service";

@Module({
  imports: [EngineModule, IdempotencyModule],
  controllers: [RunController, ArtifactController],
  providers: [RunService, RunExceptionFilter],
  exports: [RunService],
})
export class RunModule {}
