import { Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { EtagResource, EtagResourceResolver } from "../concurrency";
import type { RbacRequest } from "../rbac";
import { BillingHttpError } from "./problem";
import { BillingService } from "./billing.service";

@Injectable()
export class BillingEtagResolver implements EtagResourceResolver {
  constructor(private readonly billing: BillingService) {}

  async resolve(request: FastifyRequest): Promise<EtagResource> {
    const actor = (request as FastifyRequest & RbacRequest).actorContext;
    const instance = "/api/v1/billing/subscription";
    if (!actor) {
      throw new BillingHttpError(
        400,
        "INVALID_BILLING_REQUEST",
        "Billing actor context required",
        instance,
      );
    }
    const resource = await this.billing.getSubscription(actor.tenant_id);
    if (!resource) {
      throw new BillingHttpError(
        404,
        "BILLING_SUBSCRIPTION_NOT_FOUND",
        "Billing subscription not found",
        instance,
      );
    }
    return { resource, version: resource.version };
  }
}
