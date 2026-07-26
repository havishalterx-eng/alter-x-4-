import type { JsonValue } from "@alterx/shared-clients";

export type ProjectOpaqueResource = Readonly<Record<string, JsonValue>>;

export interface ProjectOpaquePage {
  data: ProjectOpaqueResource[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

export type ProjectActionInput = Record<string, JsonValue>;

export type ProjectCollection =
  | "audit-results"
  | "builds"
  | "deployments"
  | "previews"
  | "tests"
  | "versions";

export interface ProjectPagination {
  cursor?: string | undefined;
  limit?: number | undefined;
}
