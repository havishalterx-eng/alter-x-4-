import { Module } from "@nestjs/common";
import { sharedPool } from "../db/shared-pool";
import { ManualReviewKycProvider } from "./manual-review-kyc-provider";
import { PublisherController } from "./publisher.controller";
import { PublisherRepository } from "./publisher.repository";
import { PublisherService } from "./publisher.service";

@Module({
  controllers: [PublisherController],
  providers: [
    { provide: PublisherRepository, useFactory: () => new PublisherRepository(sharedPool(process.env.MARKETPLACE_DATABASE_URL), false) },
    ManualReviewKycProvider,
    { provide: PublisherService, inject: [PublisherRepository, ManualReviewKycProvider], useFactory: (repository: PublisherRepository, kyc: ManualReviewKycProvider) => new PublisherService(repository, kyc) },
  ],
})
export class PublisherModule {}
