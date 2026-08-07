import { Body, Controller, Get, Param, Post, Req, UseFilters } from "@nestjs/common";
import {
  MarketplaceGovernanceActionRequestSchema,
  MarketplaceGovernanceResourceTypeSchema,
} from "@alterx/contracts";
import { RequireStaffRole } from "../rbac/decorators";
import type { RbacRequest } from "../rbac/types";
import { MarketplaceGovernanceService } from "./marketplace-governance.service";
import { MarketplaceGovernanceExceptionFilter } from "./marketplace-governance-exception.filter";
import { MarketplaceGovernanceHttpError } from "./problem";

const roles = ["staff_admin", "staff_security"] as const;

@Controller("/api/v1/admin/marketplace/governance")
@UseFilters(MarketplaceGovernanceExceptionFilter)
export class MarketplaceGovernanceController {
  constructor(private readonly governance: MarketplaceGovernanceService) {}

  @Get()
  @RequireStaffRole(...roles)
  list() {
    return this.governance.list();
  }

  @Post(":resourceType/:id/actions/apply")
  @RequireStaffRole(...roles)
  act(
    @Param("resourceType") rawResourceType: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: RbacRequest,
  ) {
    const instance = `/api/v1/admin/marketplace/governance/${rawResourceType}/${id}/actions/apply`;
    const resourceType = MarketplaceGovernanceResourceTypeSchema.safeParse(rawResourceType);
    const input = MarketplaceGovernanceActionRequestSchema.safeParse(body);
    if (!resourceType.success || !input.success || !/^(lst|tlm)_[A-Za-z0-9-]+$/.test(id)) {
      throw new MarketplaceGovernanceHttpError(
        400,
        "VALIDATION_ERROR",
        "Invalid marketplace governance request",
        instance,
      );
    }
    const staffUserId = request.staffActorContext?.staff_user_id;
    if (!staffUserId) {
      throw new MarketplaceGovernanceHttpError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Authenticated staff actor required",
        instance,
      );
    }
    return this.governance.act(resourceType.data, id, staffUserId, input.data);
  }
}
