import type { ConnectorId } from "./connectors";

export interface ConnectorCatalogEntry {
  readonly id: ConnectorId;
  readonly display_name: string;
  readonly scopes: readonly string[];
  readonly pkce: boolean;
  readonly configured: boolean;
}

export interface OAuthAuthorizeInput {
  readonly redirect_uri: string;
}

export interface OAuthAuthorizeView {
  readonly authorize_url: string;
  readonly state: string;
  readonly expires_at: string;
}

export interface OAuthCallbackInput {
  readonly code: string;
  readonly state: string;
}

export interface OAuthStateRecord {
  readonly tenantId: string;
  readonly id: string;
  readonly workspaceId: string;
  readonly connector: ConnectorId;
  readonly codeVerifier: string | null;
  readonly redirectUri: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export type OAuthConnectionStatus = "connected" | "revoked" | "error";

export interface OAuthConnectionRecord {
  readonly tenantId: string;
  readonly id: string;
  readonly workspaceId: string;
  readonly connector: ConnectorId;
  readonly externalAccountId: string;
  readonly scopes: string;
  readonly status: OAuthConnectionStatus;
  readonly lastHealthStatus: string | null;
  readonly lastHealthCheckedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly useAuditPtr: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OAuthConnectionView {
  readonly id: string;
  readonly connector: ConnectorId;
  readonly external_account_id: string;
  readonly scopes: readonly string[];
  readonly status: OAuthConnectionStatus;
  readonly last_health_status: string | null;
  readonly last_health_checked_at: string | null;
  readonly created_at: string;
  readonly version: string;
}

export interface OAuthRevokeView extends OAuthConnectionView {
  readonly revoked_remotely: boolean;
  readonly revoke_disclosure?: string;
}

export interface OAuthScopesView {
  readonly connection_id: string;
  readonly scopes: readonly string[];
}

export interface IntegrationActivityQuery {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface OAuthConnectionActivityRecord {
  readonly tenantId: string;
  readonly id: string;
  readonly connectionId: string;
  readonly action: string;
  readonly usedAt: Date;
}

export interface OAuthConnectionActivityView {
  readonly id: string;
  readonly connection_id: string;
  readonly action: string;
  readonly used_at: string;
}

export interface OAuthConnectionActivityPage {
  readonly data: readonly OAuthConnectionActivityView[];
  readonly page: {
    readonly next_cursor: string | null;
    readonly has_more: boolean;
    readonly limit: number;
  };
}

export const integrationDeferredCapabilities = [
  {
    capability: "oauth_flows_non_launch_connectors",
    status: "NOT_MET",
    reason:
      "GitHub, Google, Slack, HubSpot, and LinkedIn are built. X/Salesforce/Shopify/Zendesk/M365 deferred: their OAuth URLs are per-tenant (org/shop/subdomain-based) and connectors.ts only supports one fixed global URL per connector today -- building them without that architecture change would either be wrong or require inventing per-tenant config not yet designed. Deferred to a later ticket per CONN-OAUTH-EXPAND scope decision 2026-08-06.",
  },
  {
    capability: "oauth_round_trip_verified",
    status: "NOT_MET",
    reason:
      "Real client_id/client_secret for GitHub and Google are not provisioned yet in this environment. authorize/callback/health/revoke code paths are real (no mocks), but unexercised against live provider sandboxes. Flip to MET once GITHUB_OAUTH_CLIENT_ID_SECRET_REF/GITHUB_OAUTH_CLIENT_SECRET_REF and GOOGLE_OAUTH_CLIENT_ID_SECRET_REF/GOOGLE_OAUTH_CLIENT_SECRET_REF resolve to real credentials and a live round-trip test is run.",
  },
  {
    capability: "oauth_round_trip_verified_slack",
    status: "NOT_MET",
    reason:
      "Uses Sign in with Slack (OIDC) endpoints, not the classic bot-install oauth.v2.access flow. authorize/callback/userinfo/revoke code paths are real, but unexercised against a live Slack app -- in particular unverified: whether PKCE is safe to enable for our app (left off pending confirmation) and whether auth.revoke's ok-field handling matches a real failure response. Flip to MET once SLACK_OAUTH_CLIENT_ID_SECRET_REF/SLACK_OAUTH_CLIENT_SECRET_REF resolve to real credentials and a live round-trip test is run.",
  },
  {
    capability: "oauth_round_trip_verified_hubspot",
    status: "NOT_MET",
    reason:
      "authorize/callback code paths are real, but unexercised against a live HubSpot app. In particular unverified: the hub_id extraction from GET /oauth/v1/access-tokens/{token}, and the legacy DELETE /oauth/v1/refresh-tokens/{token} revoke path (HubSpot documents this API as being replaced by a dated 2026-03+ revoke endpoint we have not adopted). Flip to MET once HUBSPOT_OAUTH_CLIENT_ID_SECRET_REF/HUBSPOT_OAUTH_CLIENT_SECRET_REF resolve to real credentials and a live round-trip test is run.",
  },
  {
    capability: "oauth_round_trip_verified_linkedin",
    status: "NOT_MET",
    reason:
      "authorize/callback/userinfo code paths are real, but unexercised against a live LinkedIn app. LinkedIn has no documented revoke endpoint at all -- revoke is local-invalidation-only by design, not a gap to close. Flip to MET once LINKEDIN_OAUTH_CLIENT_ID_SECRET_REF/LINKEDIN_OAUTH_CLIENT_SECRET_REF resolve to real credentials and a live round-trip test is run.",
  },
] as const;
