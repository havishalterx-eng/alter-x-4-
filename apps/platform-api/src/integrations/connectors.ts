export type ConnectorId = "github" | "google" | "slack" | "hubspot" | "linkedin";

export interface ConnectorDefinition {
  readonly id: ConnectorId;
  readonly displayName: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly revokeUrl: string | null;
  readonly userInfoUrl: string;
  readonly scopes: readonly string[];
  readonly pkce: boolean;
  /** Default Secrets Manager reference paths, overridable per-env via runtime config. */
  readonly defaultClientIdSecretRef: string;
  readonly defaultClientSecretSecretRef: string;
}

export const CONNECTOR_CATALOG: readonly ConnectorDefinition[] = [
  {
    id: "github",
    displayName: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    revokeUrl: null, // GitHub revoke uses a per-app DELETE grant endpoint, handled specially in the http client.
    userInfoUrl: "https://api.github.com/user",
    scopes: ["read:user", "repo"],
    pkce: false,
    defaultClientIdSecretRef: "/alter/integrations/github/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/github/client-secret",
  },
  {
    id: "google",
    displayName: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scopes: ["openid", "email", "profile"],
    pkce: true,
    defaultClientIdSecretRef: "/alter/integrations/google/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/google/client-secret",
  },
  {
    id: "slack",
    displayName: "Slack",
    // "Sign in with Slack" OIDC endpoints, not the classic bot-install
    // oauth.v2.access flow -- chosen because it's the only Slack flow that
    // fits this client's shape (token exchange + a single userinfo GET).
    authorizeUrl: "https://slack.com/openid/connect/authorize",
    tokenUrl: "https://slack.com/api/openid.connect.token",
    // Slack's only revoke mechanism is the classic auth.revoke Web API
    // method, which -- unlike the OIDC endpoints above -- always returns
    // HTTP 200 and signals failure via a JSON `ok` field. Handled as a
    // connector-specific branch in revoke(), not the generic POST path.
    revokeUrl: "https://slack.com/api/auth.revoke",
    userInfoUrl: "https://slack.com/api/openid.connect.userInfo",
    scopes: ["openid", "email", "profile"],
    // Slack's oauth.v2.access docs mention code_verifier support, but also
    // warn PKCE can be rejected if the app isn't configured for it. Left off
    // until a live app confirms it's safe to send -- see
    // oauth_round_trip_verified_slack.
    pkce: false,
    defaultClientIdSecretRef: "/alter/integrations/slack/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/slack/client-secret",
  },
  {
    id: "hubspot",
    displayName: "HubSpot",
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    // Legacy v1 OAuth API: revoke is DELETE /oauth/v1/refresh-tokens/{token}
    // -- keyed by the REFRESH token in the URL path, not the access token in
    // a request body. Handled as a connector-specific branch in revoke().
    revokeUrl: "https://api.hubapi.com/oauth/v1/refresh-tokens/",
    // GET /oauth/v1/access-tokens/{token}: the access token itself goes in
    // the URL path (self-authenticating), not an Authorization header, and
    // the account identifier is `hub_id`, not id/sub/login. Handled as a
    // connector-specific branch in fetchAccountId().
    userInfoUrl: "https://api.hubapi.com/oauth/v1/access-tokens/",
    // HubSpot has no documented identity-only base scope (unlike GitHub's
    // read:user or Google's openid/email/profile) -- every scope grants
    // access to a specific CRM object. crm.objects.contacts.read is the
    // narrowest real, documented scope; broader access is a product scoping
    // decision for whoever wires up a real HubSpot use case, not something
    // to default to here.
    scopes: ["crm.objects.contacts.read"],
    pkce: false,
    defaultClientIdSecretRef: "/alter/integrations/hubspot/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/hubspot/client-secret",
  },
  {
    id: "linkedin",
    displayName: "LinkedIn",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    // LinkedIn's 3-legged OAuth has no documented revoke/invalidate
    // endpoint at all -- not a quirk to special-case, a real capability gap.
    revokeUrl: null,
    userInfoUrl: "https://api.linkedin.com/v2/userinfo",
    scopes: ["openid", "profile", "email"],
    pkce: false,
    defaultClientIdSecretRef: "/alter/integrations/linkedin/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/linkedin/client-secret",
  },
];

export function findConnector(id: string): ConnectorDefinition | undefined {
  return CONNECTOR_CATALOG.find((connector) => connector.id === id);
}

export function isConnectorId(value: string): value is ConnectorId {
  return findConnector(value) !== undefined;
}
