export type ConnectorId = "github" | "google";

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
];

export function findConnector(id: string): ConnectorDefinition | undefined {
  return CONNECTOR_CATALOG.find((connector) => connector.id === id);
}

export function isConnectorId(value: string): value is ConnectorId {
  return findConnector(value) !== undefined;
}
