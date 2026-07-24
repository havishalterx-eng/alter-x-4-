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
  target_version: number;
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
