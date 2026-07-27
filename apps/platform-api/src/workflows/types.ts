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
    capability: "promote_version",
    status: "NOT_MET",
    reason:
      "Engine exposes version promotion through gRPC only; no REST controller is wired.",
  },
  {
    capability: "start_canary",
    status: "NOT_MET",
    reason:
      "Engine exposes canary start through gRPC only; no REST controller is wired.",
  },
  {
    capability: "rollback_version",
    status: "NOT_MET",
    reason:
      "Engine exposes workflow rollback through gRPC only; no REST controller is wired.",
  },
  {
    capability: "template_variables",
    status: "NOT_MET",
    reason:
      "Engine contract has no typed, validated, or versioned template-variable route or table.",
  },
] as const;
