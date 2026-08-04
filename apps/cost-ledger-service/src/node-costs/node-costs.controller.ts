import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";

import { NodeCostsService, NodeCostValidationError } from "./node-costs.service";

interface NodeCostsQuery {
  readonly tenantId: string;
  readonly workspaceId: string;
}

@Controller("costs")
export class NodeCostsController {
  constructor(private readonly nodeCosts: NodeCostsService) {}

  @Get("by-run/:runId")
  async getForRun(
    @Param("runId") runId: string,
    @Query() query: NodeCostsQuery,
  ): Promise<{ readonly node_costs: readonly { readonly node_execution_id: string; readonly internal_cost_minor: string; readonly event_count: number }[] }> {
    try {
      const nodeCosts = await this.nodeCosts.getForRun({
        tenantId: query.tenantId,
        workspaceId: query.workspaceId,
        runId,
      });
      return {
        node_costs: nodeCosts.map((cost) => ({
          node_execution_id: cost.nodeExecutionId,
          internal_cost_minor: cost.internalCostMinor,
          event_count: cost.eventCount,
        })),
      };
    } catch (error: unknown) {
      if (error instanceof NodeCostValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
