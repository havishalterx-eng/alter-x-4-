import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { SearchController } from "./search.controller";
import { MarketplaceSearchRepository } from "./search.repository";
import { MarketplaceSearchService } from "./search.service";
@Module({ controllers: [SearchController], providers: [{ provide: MarketplaceSearchRepository, useFactory: () => new MarketplaceSearchRepository(new Pool({ connectionString: process.env.MARKETPLACE_DATABASE_URL }), true) }, MarketplaceSearchService] })
export class SearchModule {}
