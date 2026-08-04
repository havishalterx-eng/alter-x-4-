import { BadRequestException, Controller, Get, Query } from "@nestjs/common";

import {
  CostRollupService,
  RollupValidationError,
} from "./cost-rollup.service";

interface SummaryQuery {
  readonly tenantId?: unknown;
  readonly workspaceId?: unknown;
  readonly startAt?: unknown;
  readonly endAt?: unknown;
  readonly dimensions?: unknown;
}

@Controller("costs")
export class CostSummaryController {
  constructor(private readonly rollups: CostRollupService) {}

  @Get("summary")
  async summary(@Query() query: SummaryQuery): Promise<{ readonly rollups_json: string }> {
    try {
      return await this.rollups.queryRollups({
        tenant_id: requireString(query.tenantId, "tenantId"),
        workspace_id: requireString(query.workspaceId, "workspaceId"),
        start_at: requireString(query.startAt, "startAt"),
        end_at: requireString(query.endAt, "endAt"),
        dimensions: parseDimensions(query.dimensions),
      });
    } catch (error: unknown) {
      if (error instanceof RollupValidationError || error instanceof SummaryQueryError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

class SummaryQueryError extends Error {}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SummaryQueryError(`${field} is required`);
  }
  return value;
}

function parseDimensions(value: unknown): string[] {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((dimension) => typeof dimension === "string")) {
    return value;
  }
  throw new SummaryQueryError("dimensions must be a repeated string query parameter");
}
