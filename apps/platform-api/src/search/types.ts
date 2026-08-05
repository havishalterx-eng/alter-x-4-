export const searchKinds = ["listing", "tool"] as const;
export const searchableListingTypes = ["workflow_template", "project_template", "agent"] as const;

export type SearchKind = (typeof searchKinds)[number];
export type SearchableListingType = (typeof searchableListingTypes)[number];

export interface SearchQuery {
  readonly q: string;
  readonly kind?: SearchKind;
  readonly type?: SearchableListingType;
  readonly limit: number;
  readonly cursor?: string;
}

export interface SearchResult {
  readonly kind: SearchKind;
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly rank: number;
  readonly type?: SearchableListingType;
  readonly ecosystem?: "npm" | "pip" | "mcp";
  readonly trust_level?: string;
}

export interface SearchPage {
  readonly data: readonly SearchResult[];
  readonly page: { readonly next_cursor: string | null; readonly has_more: boolean; readonly limit: number };
}
