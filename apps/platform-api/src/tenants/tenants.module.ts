import { Module } from "@nestjs/common";
import { SignupModule } from "../signup/signup.module";
import { PlatformDb } from "../signup/platform-db";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";

@Module({
  imports: [SignupModule],
  controllers: [TenantsController],
  providers: [
    {
      provide: TenantsService,
      inject: [PlatformDb],
      useFactory: (db: PlatformDb) => new TenantsService(db),
    },
  ],
})
export class TenantsModule {}
