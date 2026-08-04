import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { ManualReviewKycProvider } from "./manual-review-kyc-provider";
import { PublisherController } from "./publisher.controller";
import { PublisherRepository } from "./publisher.repository";
import { PublisherService } from "./publisher.service";

@Module({
  controllers: [PublisherController],
  providers: [
    { provide: PublisherRepository, useFactory: () => new PublisherRepository(new Pool({ connectionString: process.env.MARKETPLACE_DATABASE_URL }), true) },
    ManualReviewKycProvider,
    { provide: PublisherService, inject: [PublisherRepository, ManualReviewKycProvider], useFactory: (repository: PublisherRepository, kyc: ManualReviewKycProvider) => new PublisherService(repository, kyc) },
  ],
})
export class PublisherModule {}
