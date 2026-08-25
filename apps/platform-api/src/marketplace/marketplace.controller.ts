import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { ActorContext, RequireStaffRole, RequireWorkspaceRole, StaffActorContext, type ActorContextType, type StaffActorContextType } from "../rbac";
import { Idempotent } from "../idempotency";
import { IfMatchGuard, EtagResponseInterceptor } from "../concurrency";
import { MarketplaceHttpError } from "./problem";
import { MarketplaceService } from "./marketplace.service";
import { parseCompatibilityCheck, parseCreateListing, parseCreateListingVersion, parseCreateReview, parseInstallListing, parseListingId, parseListingQuery, parseUpdateListing } from "./validation";

const allWorkspaceRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;

@Controller("/api/v1/marketplace")
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get("listings") @RequireWorkspaceRole(...allWorkspaceRoles)
  list(@Query() query: Record<string, string | undefined>, @ActorContext() actor: ActorContextType) { return this.marketplace.list(actor.tenant_id, parseListingQuery(query, "/api/v1/marketplace/listings")); }
  @Get("listings/:listingId") @RequireWorkspaceRole(...allWorkspaceRoles)
  get(@Param("listingId") listingId: string, @ActorContext() actor: ActorContextType) { return this.marketplace.get(actor.tenant_id, parseListingId(listingId, "/api/v1/marketplace/listings")); }
  @Get("listings/:listingId/versions") @RequireWorkspaceRole(...allWorkspaceRoles)
  versions(@Param("listingId") listingId: string, @ActorContext() actor: ActorContextType) { return this.marketplace.listVersions(actor.tenant_id, parseListingId(listingId, "/api/v1/marketplace/listings")); }
  @Post("listings") @RequireWorkspaceRole("admin", "editor")
  create(@Body() body: unknown, @ActorContext() actor: ActorContextType) { return this.marketplace.create(actor.tenant_id, parseCreateListing(body, "/api/v1/marketplace/listings")); }
  @Patch("listings/:listingId") @RequireWorkspaceRole("admin", "editor") @UseGuards(IfMatchGuard) @UseInterceptors(EtagResponseInterceptor)
  update(@Param("listingId") listingId: string, @Body() body: unknown, @ActorContext() actor: ActorContextType) { return this.marketplace.update(actor.tenant_id, parseListingId(listingId, "/api/v1/marketplace/listings"), parseUpdateListing(body, "/api/v1/marketplace/listings")); }
  @Post("admin/listings/:listingId/actions/publish") @RequireStaffRole("staff_admin", "staff_security", "staff_support")
  publish(@Param("listingId") listingId: string, @StaffActorContext() staff: StaffActorContextType) { return this.marketplace.publish(staff, parseListingId(listingId, "/api/v1/marketplace/admin/listings")); }
  @Post("listings/:listingId/versions") @RequireWorkspaceRole("admin", "editor")
  createVersion(@Param("listingId") listingId: string, @Body() body: unknown, @ActorContext() actor: ActorContextType) { return this.marketplace.createVersion(actor.tenant_id, parseListingId(listingId, "/api/v1/marketplace/listings"), parseCreateListingVersion(body, "/api/v1/marketplace/listings")); }
  @Post("listings/:listingId/actions/check-compatibility") @RequireWorkspaceRole(...allWorkspaceRoles)
  compatibility(@Param("listingId") listingId: string, @Body() body: unknown, @ActorContext() actor: ActorContextType) { const input = parseCompatibilityCheck(body, "/api/v1/marketplace/listings"); return this.marketplace.compatibility(actor.tenant_id, parseListingId(listingId, "/api/v1/marketplace/listings"), input.listing_version_id); }
  @Post("listings/:listingId/actions/install") @RequireWorkspaceRole("admin", "editor") @Idempotent()
  install(@Param("listingId") listingId: string, @Body() body: unknown, @Headers("idempotency-key") idempotencyKey: string, @ActorContext() actor: ActorContextType) { if (!actor.workspace_id) throw new MarketplaceHttpError(400, "MARKETPLACE_WORKSPACE_REQUIRED", "Marketplace install requires a workspace.", "/api/v1/marketplace/listings"); return this.marketplace.install(actor.tenant_id, actor.workspace_id, parseListingId(listingId, "/api/v1/marketplace/listings"), parseInstallListing(body, "/api/v1/marketplace/listings"), idempotencyKey); }
  @Get("my-assets") @RequireWorkspaceRole(...allWorkspaceRoles)
  assets(@ActorContext() actor: ActorContextType) { return this.marketplace.listAssets(actor.tenant_id); }
  @Post("listings/:listingId/reviews") @RequireWorkspaceRole(...allWorkspaceRoles) @Idempotent()
  review(@Param("listingId") listingId: string, @Body() body: unknown, @ActorContext() actor: ActorContextType) { return this.marketplace.createReview(actor.tenant_id, parseListingId(listingId, "/api/v1/marketplace/listings"), parseCreateReview(body, "/api/v1/marketplace/listings")); }
  @Get("listings/:listingId/reviews") @RequireWorkspaceRole(...allWorkspaceRoles)
  reviews(@Param("listingId") listingId: string, @ActorContext() actor: ActorContextType) { return this.marketplace.listReviews(actor.tenant_id, parseListingId(listingId, "/api/v1/marketplace/listings")); }
}
