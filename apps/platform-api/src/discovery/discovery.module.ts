import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { ActionCentreModule } from "../action-centre/action-centre.module";
import { AdsModule } from "../ads/ads.module";
import { IdempotencyModule } from "../idempotency";
import { IntegrationModule } from "../integrations/integration.module";
import { RunModule } from "../runs/run.module";
import { WorkflowModule } from "../workflows/workflow.module";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";

@Module({
  imports: [RunModule, AdsModule, ActionCentreModule, IntegrationModule, WorkflowModule, IdempotencyModule],
  controllers: [DiscoveryController],
  providers: [
    {
      provide: DiscoveryRepository,
      useFactory: () => new DiscoveryRepository(new Pool({ connectionString: process.env.DATABASE_URL }), true),
    },
    DiscoveryService,
  ],
})
export class DiscoveryModule {}
