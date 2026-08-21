import { Controller, Get, Headers, UseFilters } from "@nestjs/common";
import { ActorContext, RequireWorkspaceRole } from "../rbac";
import type { ActorContextType } from "../rbac";
import { WorkflowHttpError } from "./problem";
import type { NodeTypeList } from "./types";
import { WorkflowExceptionFilter } from "./workflow-exception.filter";
import { WorkflowService } from "./workflow.service";

const readRoles = ["admin", "editor", "operator", "approver", "viewer"] as const;

/**
 * ENGINE-FIX-P3-8: separate top-level path (not nested under
 * /api/v1/workflows) so it never collides with the ":workflowId" route,
 * and to mirror the orchestration-service's own top-level /api/v1/node-types.
 */
@Controller("/api/v1/node-types")
@UseFilters(WorkflowExceptionFilter)
export class NodeTypeController {
  constructor(private readonly workflows: WorkflowService) {}

  @Get()
  @RequireWorkspaceRole(...readRoles)
  async list(
    @ActorContext() actor: ActorContextType | undefined,
    @Headers("traceparent") traceparent: string | undefined,
  ): Promise<NodeTypeList> {
    const instance = "/api/v1/node-types";
    const response = await this.workflows.nodeTypes(requireActor(actor, instance), traceparent);
    return response.body;
  }
}

function requireActor(actor: ActorContextType | undefined, instance: string): ActorContextType {
  if (!actor) {
    throw new WorkflowHttpError(401, "AUTHENTICATION_REQUIRED", "Authenticated actor required", instance);
  }
  return actor;
}
