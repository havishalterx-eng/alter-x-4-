import { BadRequestException, Controller, Get, Query } from "@nestjs/common";

import { ModelOutcomesService, ModelOutcomesValidationError } from "./model-outcomes.service";

interface QueryWindowParams {
  readonly provider: string;
  readonly resource?: string;
  readonly limit?: string;
}

/**
 * Real, internal, cross-tenant query surface -- mirrors
 * intelligence-service's own /internal/performance/agents/{agent_id}
 * endpoint's real shape (same "internal" prefix convention, same
 * caller-computes-the-drift-math division of responsibility). Consumed by
 * memory-service's Drift Detector for the real model/provider dimension
 * previously entirely missing.
 */
@Controller("internal/model-outcomes")
export class ModelOutcomesController {
  constructor(private readonly modelOutcomes: ModelOutcomesService) {}

  @Get()
  async queryWindow(
    @Query() query: QueryWindowParams,
  ): Promise<{ readonly observations: readonly { readonly verdict: string; readonly recorded_at: string }[] }> {
    try {
      const limit = query.limit === undefined ? 100 : Number(query.limit);
      const observations = await this.modelOutcomes.queryWindow(
        query.provider,
        query.resource,
        limit,
      );
      return {
        observations: observations.map((observation) => ({
          verdict: observation.verdict,
          recorded_at: observation.recordedAt,
        })),
      };
    } catch (error: unknown) {
      if (error instanceof ModelOutcomesValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
