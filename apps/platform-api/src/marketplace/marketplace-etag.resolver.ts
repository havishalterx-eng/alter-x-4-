import { Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { EtagResource, EtagResourceResolver } from "../concurrency";
import type { RbacRequest } from "../rbac";
import { MarketplaceHttpError } from "./problem";
import { MarketplaceService } from "./marketplace.service";

@Injectable()
export class MarketplaceEtagResolver implements EtagResourceResolver {
  constructor(private readonly marketplace: MarketplaceService) {}
  async resolve(request: FastifyRequest): Promise<EtagResource> {
    const typed = request as FastifyRequest & RbacRequest;
    const actor = typed.actorContext;
    const id = typed.params?.listingId;
    if (!actor || typeof id !== "string") throw new MarketplaceHttpError(400, "INVALID_MARKETPLACE_REQUEST", "Listing and actor context required.", request.url);
    const listing = await this.marketplace.get(actor.tenant_id, id);
    return { resource: listing, version: listing.updatedAt.toISOString() };
  }
}
