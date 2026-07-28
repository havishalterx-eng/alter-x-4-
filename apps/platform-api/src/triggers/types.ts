import type {
  Trigger,
  TriggerVersion,
} from "@alterx/contracts/src/triggers";
import type { JsonValue } from "@alterx/shared-clients";

export type {
  Trigger,
  TriggerVersion,
};

export type TriggerType = Trigger["type"];
export type TriggerStatus = Trigger["status"];
export interface RegisterTriggerResult {
  trigger: Trigger;
  triggerVersion: TriggerVersion;
}
export interface TriggerListResult {
  triggers: Trigger[];
}

export interface CreateTriggerInput {
  workspaceId: string;
  workflowId: string;
  name: string;
  type: TriggerType;
  provider?: string;
  workflowVersionId?: string;
  config?: Readonly<Record<string, JsonValue>>;
}

export interface CreateTriggerVersionInput {
  workflowVersionId?: string;
  config?: Readonly<Record<string, JsonValue>>;
}

export interface SetTriggerStatusInput {
  status: TriggerStatus;
}

export const triggerDeferredCapabilities = [
  {
    capability: "template_variables",
    status: "NOT_MET",
    reason:
      "Engine contract has no typed, validated, or versioned template-variable route or table.",
  },
] as const;
