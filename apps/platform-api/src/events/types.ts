import type { JsonValue } from "@alterx/shared-clients";

export interface EventListQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
  source?: string | undefined;
  status?: string | undefined;
}

export type EngineResource = Readonly<Record<string, JsonValue>>;

export interface EnginePage<T> {
  data: readonly T[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
}
