import { Module } from "@nestjs/common";
import { PlatformDb } from "../signup/platform-db";
import { SignupModule } from "../signup/signup.module";
import { MembersController } from "./members.controller";
import { MembersService } from "./members.service";

@Module({
  imports: [SignupModule],
  controllers: [MembersController],
  providers: [
    {
      provide: MembersService,
      inject: [PlatformDb],
      useFactory: (db: PlatformDb) => new MembersService(db),
    },
  ],
})
export class MembersModule {}
