export type ConnectorId =
  | "github"
  | "google"
  | "slack"
  | "hubspot"
  | "linkedin"
  | "zendesk"
  | "salesforce"
  | "shopify"
  | "x"
  | "m365";

export type ConnectorTenantConfig =
  | { readonly connector: "zendesk"; readonly subdomain: string }
  | { readonly connector: "salesforce"; readonly login_host: string }
  | { readonly connector: "shopify"; readonly shop_domain: string }
  | { readonly connector: "m365"; readonly tenant: string };

export interface ResolvedConnectorEndpoints {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly revokeUrl: string | null;
  readonly userInfoUrl: string;
}

export interface ConnectorDefinition {
  readonly id: ConnectorId;
  readonly displayName: string;
  readonly resolveEndpoints: (
    tenantConfig: ConnectorTenantConfig | null,
  ) => ResolvedConnectorEndpoints;
  readonly scopes: readonly string[];
  readonly scopeSeparator: " " | ",";
  readonly pkce: boolean;
  readonly defaultClientIdSecretRef: string;
  readonly defaultClientSecretSecretRef: string;
}

const globalEndpoints = (
  authorizeUrl: string,
  tokenUrl: string,
  revokeUrl: string | null,
  userInfoUrl: string,
): ConnectorDefinition["resolveEndpoints"] => () => ({
  authorizeUrl,
  tokenUrl,
  revokeUrl,
  userInfoUrl,
});

export const CONNECTOR_CATALOG: readonly ConnectorDefinition[] = [
  {
    id: "github",
    displayName: "GitHub",
    resolveEndpoints: globalEndpoints(
      "https://github.com/login/oauth/authorize",
      "https://github.com/login/oauth/access_token",
      null,
      "https://api.github.com/user",
    ),
    scopes: ["read:user", "repo"],
    scopeSeparator: " ",
    pkce: false,
    defaultClientIdSecretRef: "/alter/integrations/github/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/github/client-secret",
  },
  {
    id: "google",
    displayName: "Google",
    resolveEndpoints: globalEndpoints(
      "https://accounts.google.com/o/oauth2/v2/auth",
      "https://oauth2.googleapis.com/token",
      "https://oauth2.googleapis.com/revoke",
      "https://openidconnect.googleapis.com/v1/userinfo",
    ),
    scopes: ["openid", "email", "profile"],
    scopeSeparator: " ",
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
    // Slack's only revoke mechanism is the classic auth.revoke Web API
    // method, which -- unlike the OIDC endpoints below -- always returns
    // HTTP 200 and signals failure via a JSON `ok` field. Handled as a
    // connector-specific branch in revoke(), not the generic POST path.
    resolveEndpoints: globalEndpoints(
      "https://slack.com/openid/connect/authorize",
      "https://slack.com/api/openid.connect.token",
      "https://slack.com/api/auth.revoke",
      "https://slack.com/api/openid.connect.userInfo",
    ),
    scopes: ["openid", "email", "profile"],
    scopeSeparator: " ",
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
    // Legacy v1 OAuth API: revoke is DELETE /oauth/v1/refresh-tokens/{token}
    // -- keyed by the REFRESH token in the URL path, not the access token in
    // a request body. Handled as a connector-specific branch in revoke().
    // GET /oauth/v1/access-tokens/{token}: the access token itself goes in
    // the URL path (self-authenticating), not an Authorization header, and
    // the account identifier is `hub_id`, not id/sub/login. Handled as a
    // connector-specific branch in fetchAccountId().
    resolveEndpoints: globalEndpoints(
      "https://app.hubspot.com/oauth/authorize",
      "https://api.hubapi.com/oauth/v1/token",
      "https://api.hubapi.com/oauth/v1/refresh-tokens/",
      "https://api.hubapi.com/oauth/v1/access-tokens/",
    ),
    // HubSpot has no documented identity-only base scope (unlike GitHub's
    // read:user or Google's openid/email/profile) -- every scope grants
    // access to a specific CRM object. crm.objects.contacts.read is the
    // narrowest real, documented scope; broader access is a product scoping
    // decision for whoever wires up a real HubSpot use case, not something
    // to default to here.
    scopes: ["crm.objects.contacts.read"],
    scopeSeparator: " ",
    pkce: false,
    defaultClientIdSecretRef: "/alter/integrations/hubspot/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/hubspot/client-secret",
  },
  {
    id: "linkedin",
    displayName: "LinkedIn",
    // LinkedIn's 3-legged OAuth has no documented revoke/invalidate
    // endpoint at all -- not a quirk to special-case, a real capability gap.
    resolveEndpoints: globalEndpoints(
      "https://www.linkedin.com/oauth/v2/authorization",
      "https://www.linkedin.com/oauth/v2/accessToken",
      null,
      "https://api.linkedin.com/v2/userinfo",
    ),
    scopes: ["openid", "profile", "email"],
    scopeSeparator: " ",
    pkce: false,
    defaultClientIdSecretRef: "/alter/integrations/linkedin/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/linkedin/client-secret",
  },
  {
    id: "zendesk",
    displayName: "Zendesk",
    resolveEndpoints: (config) => {
      const subdomain = requireConfig(config, "zendesk").subdomain;
      const origin = `https://${subdomain}.zendesk.com`;
      return {
        authorizeUrl: `${origin}/oauth/authorizations/new`,
        tokenUrl: `${origin}/oauth/tokens`,
        revokeUrl: `${origin}/api/v2/oauth/tokens/current.json`,
        userInfoUrl: `${origin}/api/v2/users/me.json`,
      };
    },
    scopes: ["read", "write"],
    scopeSeparator: " ",
    pkce: true,
    defaultClientIdSecretRef: "/alter/integrations/zendesk/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/zendesk/client-secret",
  },
  {
    id: "salesforce",
    displayName: "Salesforce",
    resolveEndpoints: (config) => {
      const host = requireConfig(config, "salesforce").login_host;
      const origin = `https://${host}`;
      return {
        authorizeUrl: `${origin}/services/oauth2/authorize`,
        tokenUrl: `${origin}/services/oauth2/token`,
        revokeUrl: `${origin}/services/oauth2/revoke`,
        userInfoUrl: `${origin}/services/oauth2/userinfo`,
      };
    },
    scopes: ["openid", "api", "refresh_token"],
    scopeSeparator: " ",
    pkce: true,
    defaultClientIdSecretRef: "/alter/integrations/salesforce/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/salesforce/client-secret",
  },
  {
    id: "shopify",
    displayName: "Shopify",
    resolveEndpoints: (config) => {
      const host = requireConfig(config, "shopify").shop_domain;
      const origin = `https://${host}`;
      return {
        authorizeUrl: `${origin}/admin/oauth/authorize`,
        tokenUrl: `${origin}/admin/oauth/access_token`,
        revokeUrl: null,
        userInfoUrl: `${origin}/admin/api/latest/shop.json`,
      };
    },
    scopes: ["read_products", "read_orders"],
    scopeSeparator: ",",
    pkce: false,
    defaultClientIdSecretRef: "/alter/integrations/shopify/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/shopify/client-secret",
  },
  {
    id: "x",
    displayName: "X",
    resolveEndpoints: globalEndpoints(
      "https://x.com/i/oauth2/authorize",
      "https://api.x.com/2/oauth2/token",
      "https://api.x.com/2/oauth2/revoke",
      "https://api.x.com/2/users/me",
    ),
    scopes: ["tweet.read", "users.read", "offline.access"],
    scopeSeparator: " ",
    pkce: true,
    defaultClientIdSecretRef: "/alter/integrations/x/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/x/client-secret",
  },
  {
    id: "m365",
    displayName: "Microsoft 365",
    resolveEndpoints: (config) => {
      const tenant = requireConfig(config, "m365").tenant;
      const identityOrigin = `https://login.microsoftonline.com/${tenant}`;
      return {
        authorizeUrl: `${identityOrigin}/oauth2/v2.0/authorize`,
        tokenUrl: `${identityOrigin}/oauth2/v2.0/token`,
        revokeUrl: null,
        userInfoUrl: "https://graph.microsoft.com/v1.0/me",
      };
    },
    scopes: ["openid", "profile", "offline_access", "User.Read"],
    scopeSeparator: " ",
    pkce: true,
    defaultClientIdSecretRef: "/alter/integrations/m365/client-id",
    defaultClientSecretSecretRef: "/alter/integrations/m365/client-secret",
  },
];

export function findConnector(id: string): ConnectorDefinition | undefined {
  return CONNECTOR_CATALOG.find((connector) => connector.id === id);
}

export function isConnectorId(value: string): value is ConnectorId {
  return findConnector(value) !== undefined;
}

function requireConfig<T extends ConnectorTenantConfig["connector"]>(
  config: ConnectorTenantConfig | null,
  connector: T,
): Extract<ConnectorTenantConfig, { connector: T }> {
  if (!config || config.connector !== connector) {
    throw new Error(`Tenant configuration required for ${connector}`);
  }
  return config as Extract<ConnectorTenantConfig, { connector: T }>;
}
