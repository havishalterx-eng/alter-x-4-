import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { PublisherRepository } from "../publisher/publisher.repository";
import { IdempotencyModule } from "../idempotency";
import { createInMemoryPackageScanProvider } from "./package-scan";
import { RegistryController } from "./registry.controller";
import { RegistryRepository } from "./registry.repository";
import { RegistryService } from "./registry.service";
import { PACKAGE_SCAN_PROVIDER } from "./tokens";
@Module({ imports: [IdempotencyModule], controllers: [RegistryController], providers: [ { provide: RegistryRepository, useFactory: () => new RegistryRepository(new Pool({ connectionString: process.env.MARKETPLACE_DATABASE_URL }), true) }, { provide: PublisherRepository, useFactory: () => new PublisherRepository(new Pool({ connectionString: process.env.MARKETPLACE_DATABASE_URL }), true) }, { provide: PACKAGE_SCAN_PROVIDER, useFactory: () => createInMemoryPackageScanProvider() }, RegistryService ] }) export class RegistryModule {}
