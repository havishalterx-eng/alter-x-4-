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

// What the caller knows about this run. Every flag can only add verification or
// approval to the architecture; none removes the gate before external actions.
// Residency is not here on purpose: it is tenant-owned and read from the tenant.
export const PlanRunConstraintsSchema = z
  .object({
    customer_visible: z.boolean().optional(),
    human_approval_required: z.boolean().optional(),
    verification_required: z.boolean().optional(),
    contains_pii: z.boolean().optional(),
  })
  .strict();

export const PlanWorkflowBodySchema = z.object({
  goal: z.string().min(1),
  answers: z.record(z.string(), z.string()).optional(),
  constraints: PlanRunConstraintsSchema.optional(),
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
      constraints: parsed.constraints ?? {},
    });
  }
}
