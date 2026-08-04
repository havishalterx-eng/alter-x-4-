import { Module } from "@nestjs/common";
import { S3ObjectStorageProvider } from "@alterx/adapters";
import { Pool } from "pg";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { IdempotencyModule } from "../idempotency";
import { ConcurrencyExceptionFilter, ETAG_RESOURCE_RESOLVER, EtagResponseInterceptor, IfMatchGuard } from "../concurrency";
import { MarketplaceController } from "./marketplace.controller";
import { MarketplaceRepository } from "./marketplace.repository";
import { MarketplaceService } from "./marketplace.service";
import { MarketplaceEtagResolver } from "./marketplace-etag.resolver";
import { createInMemoryPayloadStore } from "./payload-store";
import { MARKETPLACE_PAYLOAD_STORE } from "./tokens";

@Module({
  imports: [EntitlementsModule, IdempotencyModule],
  controllers: [MarketplaceController],
  providers: [
    { provide: MarketplaceRepository, useFactory: () => new MarketplaceRepository(new Pool({ connectionString: process.env.MARKETPLACE_DATABASE_URL }), true) },
    {
      provide: MARKETPLACE_PAYLOAD_STORE,
      useFactory: () =>
        process.env.MARKETPLACE_OBJECT_STORAGE_PROVIDER === "s3"
          ? new S3ObjectStorageProvider({ region: process.env.AWS_REGION! })
          : createInMemoryPayloadStore(),
    },
    MarketplaceService,
    MarketplaceEtagResolver,
    { provide: ETAG_RESOURCE_RESOLVER, useExisting: MarketplaceEtagResolver },
    IfMatchGuard,
    EtagResponseInterceptor,
    ConcurrencyExceptionFilter,
  ],
})
export class MarketplaceModule {}
