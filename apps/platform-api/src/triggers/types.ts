import type {
  Trigger,
  TriggerVersion,
} from "@alterx/contracts";
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

export interface TriggerTestResult {
  eventId: string;
  triggerId: string;
  triggerVersion: number;
}

export interface TriggerWebhookSecretRotation {
  triggerId: string;
  secret: string;
  secretVersion: number;
}

export const triggerDeferredCapabilities = [] as const;
