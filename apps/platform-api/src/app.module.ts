import { Module } from "@nestjs/common";
import { DbModule } from "./db/db.module";
import { HealthController } from "./health/health.controller";
import { IdentityModule } from "./identity/identity.module";

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [HealthController],
})
export class AppModule {}
