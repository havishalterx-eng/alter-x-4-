import { Module } from "@nestjs/common";
import { EngineModule } from "../engine";
import { ArtifactController, RunController } from "./run.controller";
import { RunExceptionFilter } from "./run-exception.filter";
import { RunService } from "./run.service";

@Module({
  imports: [EngineModule],
  controllers: [RunController, ArtifactController],
  providers: [RunService, RunExceptionFilter],
  exports: [RunService],
})
export class RunModule {}
