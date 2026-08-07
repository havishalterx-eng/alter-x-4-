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

export interface WorkflowVersionActionInput {
  workflowVersionId: string;
}

export interface StartCanaryInput extends WorkflowVersionActionInput {
  trafficPercent: number;
}

export type TemplateVariableType = "text" | "number" | "secret" | "list";

export interface TemplateVariableDefinition {
  name: string;
  value_type: TemplateVariableType;
  required: boolean;
}

export interface ReplaceTemplateVariablesInput {
  definitions: readonly TemplateVariableDefinition[];
}

export interface SetTemplateVariableValueInput {
  value: JsonValue;
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

export const workflowDeferredCapabilities = [] as const;
