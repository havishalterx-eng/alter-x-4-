import { Body, Controller, Get, Headers, Post, Query, UseFilters } from "@nestjs/common";
import {
  ActorContext,
  RequirePermission,
  RequireWorkspaceRole,
  type ActorContextType,
} from "../rbac";
import { CostsExceptionFilter } from "./costs-exception.filter";
import { CostsService } from "./costs.service";
import type { CostEstimate, CostSummary } from "./types";

const readRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;

@Controller("/api/v1/costs")
@UseFilters(CostsExceptionFilter)
@RequireWorkspaceRole(...readRoles)
@RequirePermission("billing:read")
export class CostsController {
  constructor(private readonly costs: CostsService) {}

  @Get("summary")
  summary(
    @Query() query: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
  ): Promise<CostSummary> {
    return this.costs.summary(query, actor, traceparent);
  }

  @Post("estimate")
  estimate(
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
  ): Promise<CostEstimate> {
    return this.costs.estimate(body, actor, traceparent);
  }
}
