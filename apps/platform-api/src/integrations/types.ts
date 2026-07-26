import type { JsonValue } from "@alterx/shared-clients";

export type IntegrationResource = Readonly<Record<string, JsonValue>>;
export type IntegrationInput = Record<string, JsonValue>;

export interface IntegrationPage {
  data: IntegrationResource[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

export interface IntegrationPagination {
  cursor?: string | undefined;
  limit?: number | undefined;
}

export const integrationDeferredCapabilities = [
  {
    capability: "oauth_flows",
    status: "NOT_MET",
    reason:
      "Engine contract has no integration authorize, callback, or connect endpoint.",
  },
  {
    capability: "connection_health_monitoring",
    status: "NOT_MET",
    reason:
      "Engine contract exposes one-shot connection testing only; no health-monitoring endpoint exists.",
  },
  {
    capability: "scope_display_revocation",
    status: "NOT_MET",
    reason:
      "Engine contract has no integration scope-display or revocation endpoint.",
  },
  {
    capability: "per_workspace_binding",
    status: "NOT_MET",
    reason:
      "Integration resources are opaque and contract declares no workspace-binding field or endpoint.",
  },
] as const;
