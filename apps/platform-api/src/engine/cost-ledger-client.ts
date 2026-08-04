import { Inject, Injectable } from "@nestjs/common";

import {
  ENGINE_AUTH_PROVIDER,
  type EngineAuthProvider,
} from "./auth";
import type { EngineConfig } from "./config";
import { ENGINE_CONFIG } from "./engine-client";
import { EngineProblemError, upstreamProblem } from "./problem";
import type { EngineCallerContext } from "./types";

export interface NodeCost {
  readonly nodeExecutionId: string;
  readonly internalCostMinor: string;
  readonly eventCount: number;
}

interface NodeCostsResponse {
  readonly node_costs: readonly {
    readonly node_execution_id: string;
    readonly internal_cost_minor: string;
    readonly event_count: number;
  }[];
}

@Injectable()
export class CostLedgerClient {
  constructor(
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
    @Inject(ENGINE_AUTH_PROVIDER)
    private readonly authProvider: EngineAuthProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getNodeCosts(
    runId: string,
    context: EngineCallerContext,
  ): Promise<readonly NodeCost[]> {
    let authorization;
    try {
      authorization = await this.authProvider.authorize(context);
    } catch {
      throw new EngineProblemError(
        upstreamProblem(502, `/api/v1/runs/${runId}`, "UPSTREAM_SERVICE_ERROR"),
      );
    }

    const query = new URLSearchParams({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
    });
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.config.costLedgerBaseUrl.replace(/\/+$/, "")}/costs/by-run/${encodeURIComponent(runId)}?${query}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${authorization.m2mAccessToken}`,
            "X-Alter-Actor-Token": authorization.actorToken,
            traceparent: context.traceparent,
            Accept: "application/json, application/problem+json",
          },
        },
      );
    } catch {
      throw new EngineProblemError(
        upstreamProblem(502, `/api/v1/runs/${runId}`, "UPSTREAM_SERVICE_ERROR"),
      );
    }
    if (!response.ok) {
      throw new EngineProblemError(
        upstreamProblem(
          response.status >= 500 ? response.status : 502,
          `/api/v1/runs/${runId}`,
          "UPSTREAM_SERVICE_ERROR",
        ),
      );
    }

    const parsed = await parseNodeCosts(response, runId);
    return parsed.node_costs.map((cost) => ({
      nodeExecutionId: cost.node_execution_id,
      internalCostMinor: cost.internal_cost_minor,
      eventCount: cost.event_count,
    }));
  }
}

async function parseNodeCosts(response: Response, runId: string): Promise<NodeCostsResponse> {
  try {
    const body: unknown = await response.json();
    if (
      !isRecord(body) ||
      !Array.isArray(body.node_costs) ||
      !body.node_costs.every(isNodeCost)
    ) {
      throw new Error("invalid node cost response");
    }
    return body as unknown as NodeCostsResponse;
  } catch {
    throw new EngineProblemError(
      upstreamProblem(502, `/api/v1/runs/${runId}`, "UPSTREAM_SERVICE_ERROR"),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeCost(value: unknown): value is NodeCostsResponse["node_costs"][number] {
  return (
    isRecord(value) &&
    typeof value.node_execution_id === "string" &&
    /^node_[0-9a-f-]{36}$/i.test(value.node_execution_id) &&
    typeof value.internal_cost_minor === "string" &&
    /^\d+$/.test(value.internal_cost_minor) &&
    typeof value.event_count === "number" &&
    Number.isSafeInteger(value.event_count) &&
    value.event_count > 0
  );
}
