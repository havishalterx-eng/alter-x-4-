import { Module } from "@nestjs/common";
import { PublisherRepository } from "../publisher/publisher.repository";
import { IdempotencyModule } from "../idempotency";
import { sharedPool } from "../db/shared-pool";
import { createInMemoryPackageScanProvider } from "./package-scan";
import { RegistryController } from "./registry.controller";
import { RegistryRepository } from "./registry.repository";
import { RegistryService } from "./registry.service";
import { PACKAGE_SCAN_PROVIDER } from "./tokens";
@Module({ imports: [IdempotencyModule], controllers: [RegistryController], providers: [ { provide: RegistryRepository, useFactory: () => new RegistryRepository(sharedPool(process.env.MARKETPLACE_DATABASE_URL), false) }, { provide: PublisherRepository, useFactory: () => new PublisherRepository(sharedPool(process.env.MARKETPLACE_DATABASE_URL), false) }, { provide: PACKAGE_SCAN_PROVIDER, useFactory: () => createInMemoryPackageScanProvider() }, RegistryService ] }) export class RegistryModule {}
