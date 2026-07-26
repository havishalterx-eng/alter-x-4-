import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  EngineClient,
  type EngineCallerContext,
  type EnginePath,
  type EngineResponse,
} from "../engine";
import type { ActorContext } from "../rbac/types";
import { RunHttpError } from "./problem";
import type {
  EnginePage,
  EngineResource,
  RunDetail,
} from "./types";
import {
  parseArtifactId,
  parseRunId,
  parseRunListQuery,
  parseTraceparent,
  serializeQuery,
} from "./validation";

const maximumAggregatePages = 100;

@Injectable()
export class RunService {
  constructor(private readonly engine: EngineClient) {}

  list(
    input: unknown,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<EnginePage<EngineResource>>> {
    const instance = "/api/v1/runs";
    const query = parseRunListQuery(input, instance);
    return this.engine.get(
      `/api/v1/runs${serializeQuery(query)}`,
      callerContext(actor, traceparent, instance),
    );
  }

  async detail(
    runId: string,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<RunDetail>> {
    const instance = `/api/v1/runs/${runId}`;
    const id = parseRunId(runId, instance);
    const context = callerContext(actor, traceparent, instance);
    const encodedId = encodeURIComponent(id);
    const [run, executions, verification, recovery, qualityGates, outcome] =
      await Promise.all([
        this.engine.get<EngineResource>(`/api/v1/runs/${encodedId}`, context),
        this.allPages(
          `/api/v1/runs/${encodedId}/node-executions`,
          context,
          instance,
        ),
        this.allPages(
          `/api/v1/runs/${encodedId}/verification-results`,
          context,
          instance,
        ),
        this.allPages(
          `/api/v1/runs/${encodedId}/recovery-actions`,
          context,
          instance,
        ),
        this.allPages(
          `/api/v1/runs/${encodedId}/quality-gates`,
          context,
          instance,
        ),
        this.engine.get<EngineResource>(
          `/api/v1/runs/${encodedId}/outcome`,
          context,
        ),
      ]);

    return {
      ...run,
      body: {
        run: run.body,
        node_executions: executions,
        verification_results: verification,
        recovery_actions: recovery,
        quality_gates: qualityGates,
        outcome: outcome.body,
      },
    };
  }

  artifact(
    artifactId: string,
    actor: ActorContext,
    traceparent: string | undefined,
  ): Promise<EngineResponse<EngineResource>> {
    const instance = `/api/v1/artifacts/${artifactId}`;
    const id = parseArtifactId(artifactId, instance);
    return this.engine.get(
      `/api/v1/artifacts/${encodeURIComponent(id)}`,
      callerContext(actor, traceparent, instance),
    );
  }

  private async allPages(
    path: EnginePath,
    context: EngineCallerContext,
    instance: string,
  ): Promise<readonly EngineResource[]> {
    const records: EngineResource[] = [];
    let cursor: string | undefined;
    for (
      let pageNumber = 0;
      pageNumber < maximumAggregatePages;
      pageNumber += 1
    ) {
      const query = serializeQuery({ cursor, limit: 200 });
      const response = await this.engine.get<EnginePage<EngineResource>>(
        `${path}${query}`,
        context,
      );
      records.push(...response.body.data);
      if (!response.body.page.has_more) return records;
      if (!response.body.page.next_cursor) {
        throw invalidEngineResponse(instance);
      }
      cursor = response.body.page.next_cursor;
    }
    throw invalidEngineResponse(instance);
  }
}

function invalidEngineResponse(instance: string): RunHttpError {
  return new RunHttpError(
    502,
    "INVALID_ENGINE_RUN_RESPONSE",
    "Engine returned an invalid run response",
    instance,
  );
}

function callerContext(
  actor: ActorContext,
  traceparent: string | undefined,
  instance: string,
): EngineCallerContext {
  if (!actor.workspace_id) {
    throw new RunHttpError(
      403,
      "RUN_WORKSPACE_REQUIRED",
      "Workspace context required",
      instance,
    );
  }
  return {
    userId: actor.user_id,
    tenantId: actor.tenant_id,
    workspaceId: actor.workspace_id,
    sessionId: actor.session_id,
    authTime: actor.auth_time ?? Math.floor(Date.now() / 1000),
    roles: actor.roles,
    permissions: actor.permissions,
    traceparent: parseTraceparent(traceparent, instance) ?? newTraceparent(),
  };
}

function newTraceparent(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}
