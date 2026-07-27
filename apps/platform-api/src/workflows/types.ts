import type { CompiledDag } from "@alterx/contracts";
import type { JsonValue } from "@alterx/shared-clients";

export interface CreateWorkflowInput {
  goal: string;
}

export interface SaveCanvasInput {
  dag: CompiledDag;
}

export interface SimulateWorkflowInput {
  input: Readonly<Record<string, JsonValue>>;
}

export interface RollbackWorkflowInput {
  target_version_id: string;
}

export interface PromoteWorkflowVersionInput {
  workflow_version_id: string;
}

export interface StartWorkflowCanaryInput {
  workflow_version_id: string;
  traffic_percent: number;
}

export interface PromoteWorkflowVersionResult {
  status: "promoted";
  promoted_at: string;
}

export interface StartWorkflowCanaryResult {
  status: "canary";
  traffic_percent: number;
}

export interface RollbackWorkflowVersionResult {
  status: "rolled_back";
  active_version_id: string;
}

export type EmptyWorkflowActionInput = Readonly<Record<never, never>>;
export type WorkflowResource = Readonly<Record<string, JsonValue>>;
export type WorkflowActionResult = Readonly<Record<string, JsonValue>>;

export interface WorkflowVersionList {
  data: readonly WorkflowResource[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
}

export const workflowDeferredCapabilities = [
  {
    capability: "template_variables",
    status: "NOT_MET",
    reason:
      "Engine contract has no typed, validated, or versioned template-variable route or table.",
  },
] as const;
