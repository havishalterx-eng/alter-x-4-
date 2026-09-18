import { Body, Controller, Get, Headers, Param, Put, UseFilters, UseInterceptors } from "@nestjs/common";
import { ConcurrencyExceptionFilter, EtagResponseInterceptor } from "../concurrency";
import { ActorContext, RequireWorkspaceRole, type ActorContextType } from "../rbac";
import { WorkflowSafeguardsService } from "./workflow-safeguards.service";

@Controller("/api/v1/workflows/:workflowId/safeguards")
export class WorkflowSafeguardsController {
  constructor(private readonly safeguards: WorkflowSafeguardsService) {}

  @Get()
  @RequireWorkspaceRole("admin", "editor", "operator", "approver", "viewer")
  @UseInterceptors(EtagResponseInterceptor)
  get(@Param("workflowId") workflowId: string, @ActorContext() actor: ActorContextType) {
    return this.safeguards.get(actor, workflowId);
  }

  // The same roles that may plan the workflow may add safeguards to it.
  @Put()
  @RequireWorkspaceRole("admin", "editor")
  @UseInterceptors(EtagResponseInterceptor)
  @UseFilters(ConcurrencyExceptionFilter)
  set(
    @Param("workflowId") workflowId: string,
    @Body() body: unknown,
    @Headers("if-match") ifMatch: string | undefined,
    @ActorContext() actor: ActorContextType,
  ) {
    return this.safeguards.set(actor, workflowId, body, ifMatch);
  }
}
