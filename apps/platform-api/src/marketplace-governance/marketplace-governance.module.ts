import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { Pool } from "pg";
import { AdminAuditModule } from "../admin-audit";
import { StaffAuthMiddleware, StaffModule } from "../staff";
import { MarketplaceGovernanceController } from "./marketplace-governance.controller";
import { MarketplaceGovernanceExceptionFilter } from "./marketplace-governance-exception.filter";
import { MarketplaceGovernanceRepository } from "./marketplace-governance.repository";
import { MarketplaceGovernanceService } from "./marketplace-governance.service";

@Module({
  imports: [AdminAuditModule, StaffModule],
  controllers: [MarketplaceGovernanceController],
  providers: [
    {
      provide: MarketplaceGovernanceRepository,
      useFactory: () => new MarketplaceGovernanceRepository(
        process.env.OPERATIONS_MARKETPLACE_DATABASE_URL
          ? new Pool({ connectionString: process.env.OPERATIONS_MARKETPLACE_DATABASE_URL })
          : undefined,
        true,
      ),
    },
    MarketplaceGovernanceService,
    MarketplaceGovernanceExceptionFilter,
  ],
})
export class MarketplaceGovernanceModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(StaffAuthMiddleware).forRoutes(MarketplaceGovernanceController);
  }
}
