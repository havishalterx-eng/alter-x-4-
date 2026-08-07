import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/engine.module";
import { AdminAuditService } from "./admin-audit.service";

@Module({
  imports: [EngineModule],
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}
