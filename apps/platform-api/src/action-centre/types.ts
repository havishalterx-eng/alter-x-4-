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

export type QueueSourceType = "approval" | "clarification" | "escalation";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

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
}

export interface ActionQueueQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
  type?: QueueSourceType | undefined;
  status?: ApprovalStatus | undefined;
}
