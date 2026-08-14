import { Injectable, Inject } from "@nestjs/common";
import { PlannerClient, type PlannerHttpClient } from "@alterx/adapters";
import { CompilerServiceClient } from "./compiler-client";
import { randomUUID } from "node:crypto";
import { getCompilerProtoPath } from "./compiler-client";
import { ENGINE_M2M_TOKEN_PROVIDER, type EngineM2mTokenProvider } from "../engine/auth";

export function createFetchPlannerHttpClient(tokenProvider: (tenantId: string) => Promise<string>): PlannerHttpClient {
  return {
    async postJson(url: string, body: unknown): Promise<unknown> {
      // The decompose request always contains tenant_id
      const bodyRecord = body as Record<string, unknown>;
      const tenantId = typeof bodyRecord.tenant_id === "string" ? bodyRecord.tenant_id : "";
      const token = await tokenProvider(tenantId);

      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "content-type": "application/json",
          "authorization": `Bearer ${token}`
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Planner request to ${url} failed with status ${response.status}: ${detail}`,
        );
      }
      return response.json();
    },
  };
}

export interface PlanWorkflowInput {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workflowId: string;
  readonly objective: string;
}

export type PlanWorkflowResult = 
  | { type: "clarification"; questions: readonly string[] }
  | { type: "compiled"; versionId: string };

@Injectable()
export class PlannerFacadeService {
  private plannerClient: PlannerClient;
  private compilerClient: CompilerServiceClient;

  constructor(
    @Inject(ENGINE_M2M_TOKEN_PROVIDER) private readonly m2mTokenProvider: EngineM2mTokenProvider,
  ) {
    const intelligenceUrl = process.env.INTELLIGENCE_SERVICE_URL || "http://127.0.0.1:8000";
    
    this.plannerClient = new PlannerClient(
      { baseUrl: intelligenceUrl },
      createFetchPlannerHttpClient((tenantId) => this.m2mTokenProvider.getAccessToken(tenantId))
    );

    // 50051 is model-gateway's gRPC port -- the compiler lives in
    // orchestration-service, bound per .env.local's
    // COMPILER_GRPC_BIND_ADDRESS.
    const compilerAddress = process.env.ORCHESTRATION_GRPC_URL || "127.0.0.1:50071";
    this.compilerClient = new CompilerServiceClient({
      address: compilerAddress,
      protoPath: getCompilerProtoPath(),
    });
  }

  async planWorkflow(input: PlanWorkflowInput): Promise<PlanWorkflowResult> {
    const runId = `run_${randomUUID().slice(0, 14)}7${randomUUID().slice(15)}`;

    const decomposeResponse = await this.plannerClient.decompose({
      tenant_id: prefixed("ten", input.tenantId),
      workspace_id: prefixed("ws", input.workspaceId),
      run_id: runId,
      objective: input.objective,
      strategy: "default",
    });

    if (decomposeResponse.ambiguity_detected && decomposeResponse.clarification_questions.length > 0) {
      return {
        type: "clarification",
        questions: decomposeResponse.clarification_questions,
      };
    }

    const compileResponse = await this.compilerClient.compileWorkflow({
      tenant_id: prefixed("ten", input.tenantId),
      workflow_id: input.workflowId,
      task_skeleton_json: decomposeResponse.task_skeleton_json,
      dag_schema_version: "v1",
    });

    return {
      type: "compiled",
      versionId: compileResponse.workflow_version_id,
    };
  }
}

// intelligence-service and the compiler both enforce <prefix>_<UUIDv7> on
// tenant_id/workspace_id (packages/contracts/src/ids.ts); ActorContext only
// carries the bare UUID.
function prefixed(prefix: "ten" | "ws", id: string): string {
  return id.startsWith(`${prefix}_`) ? id : `${prefix}_${id}`;
}
