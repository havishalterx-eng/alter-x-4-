import type { JsonValue } from "@alterx/shared-clients";

export type EngineResource = Readonly<Record<string, JsonValue>>;

export interface EnginePage<T> {
  data: readonly T[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
}

export type QueueSourceType = "approval" | "escalation";

export interface ActionQueueItem {
  source_type: QueueSourceType;
  item: EngineResource;
}

export interface ActionQueuePage {
  data: readonly ActionQueueItem[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
  deferred: typeof humanActionCentreDeferred;
}

export interface ActionQueueQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
  type?: QueueSourceType | undefined;
  status?: "pending" | undefined;
}

export const humanActionCentreDeferred = [
  {
    capability: "clarifications_in_queue",
    status: "NOT_MET",
    reason: "Engine has no clarifications list endpoint.",
  },
  {
    capability: "universal_claim",
    status: "NOT_MET",
    reason: "Engine claim is declared only for escalations.",
  },
  {
    capability: "annotate",
    status: "NOT_MET",
    reason: "Engine has no action-item annotation endpoint.",
  },
  {
    capability: "assign_reassign",
    status: "NOT_MET",
    reason: "Engine has no assignment endpoint or declared assignee field.",
  },
  {
    capability: "expiry",
    status: "NOT_MET",
    reason: "Engine exposes no action-item expiry surface.",
  },
] as const;
