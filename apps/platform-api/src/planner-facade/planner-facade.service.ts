import { Injectable, Inject, Optional } from "@nestjs/common";
import { PlannerClient, type PlannerHttpClient } from "@alterx/adapters";
import { CompilerServiceClient } from "./compiler-client";
import { randomUUID } from "node:crypto";
import { getCompilerProtoPath } from "./compiler-client";
import { ENGINE_M2M_TOKEN_PROVIDER, type EngineM2mTokenProvider } from "../engine/auth";

export function createFetchPlannerHttpClient(tokenProvider: () => Promise<string>): PlannerHttpClient {
  return {
    async postJson(url: string, body: unknown): Promise<unknown> {
      // Service-level credential only -- the tenant travels in the request
      // body (and, for Engine calls, the actor token), never in the M2M
      // grant. See EngineM2mTokenProvider for why tenant-scoping this call
      // is wrong and breaks against real Auth0.
      const token = await tokenProvider();

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
  private readonly plannerClient: PlannerClient;
  private readonly compilerClient: CompilerServiceClient;

  constructor(
    @Inject(ENGINE_M2M_TOKEN_PROVIDER) private readonly m2mTokenProvider: EngineM2mTokenProvider,
    // Both real clients already support an injectable transport
    // (PlannerClient's httpClient param, CompilerServiceClient's raw gRPC
    // client param) -- @Optional() here just lets a test construct this
    // service directly with fakes wired through those existing seams,
    // without inventing a new one. Nest has no provider registered for
    // either class, so in the real app these always resolve to
    // undefined and this falls through to the exact same construction
    // that ran unconditionally before -- zero behavior change.
    @Optional() plannerClient?: PlannerClient,
    @Optional() compilerClient?: CompilerServiceClient,
  ) {
    const intelligenceUrl = process.env.INTELLIGENCE_SERVICE_URL || "http://127.0.0.1:8000";

    this.plannerClient = plannerClient ?? new PlannerClient(
      { baseUrl: intelligenceUrl },
      createFetchPlannerHttpClient(() => this.m2mTokenProvider.getAccessToken())
    );

    // 50051 is model-gateway's gRPC port -- the compiler lives in
    // orchestration-service, bound per .env.local's
    // COMPILER_GRPC_BIND_ADDRESS.
    const compilerAddress = process.env.ORCHESTRATION_GRPC_URL || "127.0.0.1:50071";
    this.compilerClient = compilerClient ?? new CompilerServiceClient({
      address: compilerAddress,
      protoPath: getCompilerProtoPath(),
    });
  }

  async planWorkflow(input: PlanWorkflowInput): Promise<PlanWorkflowResult> {
    const runId = `run_${randomUUID().slice(0, 14)}7${randomUUID().slice(15)}`;
    const tenantId = prefixed("ten", input.tenantId);
    const workspaceId = prefixed("ws", input.workspaceId);
    const problemSpec = await this.plannerClient.understand({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      run_id: runId,
      objective: input.objective,
    });

    const decomposeResponse = await this.plannerClient.decompose({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      run_id: runId,
      strategy: "default",
      problem_spec_json: JSON.stringify(problemSpec),
    });

    if (decomposeResponse.ambiguity_detected && decomposeResponse.clarification_questions.length > 0) {
      return {
        type: "clarification",
        questions: decomposeResponse.clarification_questions,
      };
    }

    const prepared = await this.plannerClient.prepareCompilerInput({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      task_skeleton: JSON.parse(decomposeResponse.task_skeleton_json),
    });
    if (prepared.status !== "ready") throw new Error("Architecture pipeline blocked compilation");
    const compileResponse = await this.compilerClient.compileArchitectureWorkflow({
      tenant_id: tenantId, workspace_id: workspaceId, workflow_id: input.workflowId,
      architecture_json: JSON.stringify(prepared.architecture),
      binding_decision_json: JSON.stringify(prepared.binding_decision),
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
