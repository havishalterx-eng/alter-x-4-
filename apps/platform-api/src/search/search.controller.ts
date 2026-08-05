import { Controller, Get, Query } from "@nestjs/common";
import { ActorContext, RequireWorkspaceRole, type ActorContextType } from "../rbac";
import { MarketplaceSearchService } from "./search.service";
import { parseSearchQuery } from "./validation";
const roles = ["admin", "editor", "operator", "approver", "viewer"] as const;
@Controller("/api/v1/search")
export class SearchController {
  constructor(private readonly search: MarketplaceSearchService) {}
  @Get() @RequireWorkspaceRole(...roles)
  list(@Query() query: Record<string, string | undefined>, @ActorContext() actor: ActorContextType) { return this.search.search(actor.tenant_id, parseSearchQuery(query, "/api/v1/search")); }
}
