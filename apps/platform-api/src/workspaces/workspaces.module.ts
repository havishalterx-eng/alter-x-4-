import { Module } from "@nestjs/common";
import { PlatformDb } from "../signup/platform-db";
import { SignupModule } from "../signup/signup.module";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

@Module({
  imports: [SignupModule],
  controllers: [WorkspacesController],
  providers: [
    {
      provide: WorkspacesService,
      inject: [PlatformDb],
      useFactory: (db: PlatformDb) => new WorkspacesService(db),
    },
  ],
})
export class WorkspacesModule {}
