import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
} from "@nestjs/common";
import { Idempotent } from "../idempotency";
import {
  ActorContext,
  RequireWorkspaceRole,
  type ActorContextType,
} from "../rbac";
import { PlannerFacadeService } from "./planner-facade.service";
import { z } from "zod";

const writeRoles = ["admin", "editor"] as const;

export const PlanWorkflowBodySchema = z.object({
  goal: z.string().min(1),
  answers: z.record(z.string(), z.string()).optional(),
});

@Controller("/api/v1/workflows/:workflowId/actions")
export class PlannerFacadeController {
  constructor(private readonly plannerFacade: PlannerFacadeService) {}

  @Post("plan")
  @HttpCode(200)
  @RequireWorkspaceRole(...writeRoles)
  @Idempotent()
  async plan(
    @Param("workflowId") workflowId: string,
    @Body() body: unknown,
    @ActorContext() actor: ActorContextType,
  ) {
    const parsed = PlanWorkflowBodySchema.parse(body);

    // Reconstruct the objective including answers
    let objective = parsed.goal;
    if (parsed.answers && Object.keys(parsed.answers).length > 0) {
      const parts = [objective];
      for (const [question, answer] of Object.entries(parsed.answers)) {
        parts.push(`Clarification: ${question} Answer: ${answer}`);
      }
      objective = parts.join("\n\n");
    }

    // Call the facade service
    return await this.plannerFacade.planWorkflow({
      tenantId: actor.tenant_id,
      workspaceId: actor.workspace_id ?? "",
      workflowId,
      objective,
    });
  }
}
