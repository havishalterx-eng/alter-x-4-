import { Module } from "@nestjs/common";
import { sharedPool } from "../db/shared-pool";
import { SearchController } from "./search.controller";
import { MarketplaceSearchRepository } from "./search.repository";
import { MarketplaceSearchService } from "./search.service";
@Module({ controllers: [SearchController], providers: [{ provide: MarketplaceSearchRepository, useFactory: () => new MarketplaceSearchRepository(sharedPool(process.env.MARKETPLACE_DATABASE_URL), false) }, MarketplaceSearchService] })
export class SearchModule {}
