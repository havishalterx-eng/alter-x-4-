import { createHash, randomBytes } from "node:crypto";
import type {
  ConnectorId,
  ResolvedConnectorEndpoints,
} from "../../connectors";

export interface TokenExchangeParams {
  readonly connector: ConnectorId;
  readonly endpoints: ResolvedConnectorEndpoints;
  readonly code: string;
  readonly codeVerifier: string | null;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface TokenExchangeResult {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly tokenType: string;
  readonly expiresAt: string | null;
  readonly grantedScopes: string | null;
}

export interface RevokeParams {
  readonly connector: ConnectorId;
  readonly endpoints: ResolvedConnectorEndpoints;
  readonly accessToken: string;
  // Only HubSpot's legacy revoke endpoint needs this (it revokes by refresh
  // token, not access token). Null for connectors that don't need it, or
  // when no refresh token was ever issued.
  readonly refreshToken: string | null;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface RevokeResult {
  readonly revokedRemotely: boolean;
  readonly reason?: string;
}

export interface OAuthHttpClient {
  exchangeCode(params: TokenExchangeParams): Promise<TokenExchangeResult>;
  fetchAccountId(
    connector: ConnectorId,
    userInfoUrl: string,
    accessToken: string,
  ): Promise<string>;
  revoke(params: RevokeParams): Promise<RevokeResult>;
}

export function generatePkcePair(): {
  readonly verifier: string;
  readonly challenge: string;
} {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return base64Url(randomBytes(32));
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function createFetchOAuthHttpClient(): OAuthHttpClient {
  return {
    async exchangeCode(params: TokenExchangeParams): Promise<TokenExchangeResult> {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
        client_id: params.clientId,
      });
      if (params.connector !== "x") {
        body.set("client_secret", params.clientSecret);
      }
      if (params.codeVerifier) body.set("code_verifier", params.codeVerifier);
      const response = await fetch(params.endpoints.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          ...(params.connector === "x"
            ? {
                authorization: `Basic ${Buffer.from(`${params.clientId}:${params.clientSecret}`).toString("base64")}`,
              }
            : {}),
        },
        body: body.toString(),
      });
      if (!response.ok) {
        throw new Error(
          `OAuth token exchange for ${params.connector} failed with status ${response.status}`,
        );
      }
      const json = (await response.json()) as Record<string, unknown>;
      if (typeof json.access_token !== "string") {
        throw new Error(
          `OAuth token exchange for ${params.connector} did not return access_token`,
        );
      }
      const expiresIn =
        typeof json.expires_in === "number" ? json.expires_in : undefined;
      return {
        accessToken: json.access_token,
        refreshToken:
          typeof json.refresh_token === "string" ? json.refresh_token : null,
        tokenType:
          typeof json.token_type === "string" ? json.token_type : "bearer",
        expiresAt: expiresIn
          ? new Date(Date.now() + expiresIn * 1_000).toISOString()
          : null,
        grantedScopes: typeof json.scope === "string" ? json.scope : null,
      };
    },

    async fetchAccountId(
      connector: ConnectorId,
      userInfoUrl: string,
      accessToken: string,
    ): Promise<string> {
      // HubSpot's GET /oauth/v1/access-tokens/{token} is self-authenticating
      // via the token in the URL path -- there is no Authorization header,
      // and the account identifier is `hub_id`, not id/sub/login.
      if (connector === "hubspot") {
        const response = await fetch(
          `${userInfoUrl}${encodeURIComponent(accessToken)}`,
          { headers: { accept: "application/json" } },
        );
        if (!response.ok) {
          throw new Error(
            `OAuth account lookup for ${connector} failed with status ${response.status}`,
          );
        }
        const json = (await response.json()) as Record<string, unknown>;
        if (json.hub_id === undefined || json.hub_id === null) {
          throw new Error(
            `OAuth account lookup for ${connector} did not return an account identifier`,
          );
        }
        return String(json.hub_id);
      }

      const response = await fetch(userInfoUrl, {
        headers: {
          ...(connector === "shopify"
            ? { "x-shopify-access-token": accessToken }
            : { authorization: `Bearer ${accessToken}` }),
          accept: "application/json",
          "user-agent": "alterx-platform-api",
        },
      });
      if (!response.ok) {
        throw new Error(
          `OAuth account lookup for ${connector} failed with status ${response.status}`,
        );
      }
      const json = (await response.json()) as Record<string, unknown>;
      const nested =
        connector === "shopify" && isRecord(json.shop)
          ? json.shop
          : connector === "x" && isRecord(json.data)
            ? json.data
            : connector === "zendesk" && isRecord(json.user)
              ? json.user
              : json;
      const accountId = nested.id ?? nested.sub ?? nested.login ?? nested.user_id;
      if (accountId === undefined || accountId === null) {
        throw new Error(
          `OAuth account lookup for ${connector} did not return an account identifier`,
        );
      }
      return String(accountId);
    },

    async revoke(params: RevokeParams): Promise<RevokeResult> {
      if (params.connector === "github") {
        const response = await fetch(
          `https://api.github.com/applications/${encodeURIComponent(params.clientId)}/grant`,
          {
            method: "DELETE",
            headers: {
              authorization: `Basic ${Buffer.from(`${params.clientId}:${params.clientSecret}`).toString("base64")}`,
              accept: "application/vnd.github+json",
              "content-type": "application/json",
              "user-agent": "alterx-platform-api",
            },
            body: JSON.stringify({ access_token: params.accessToken }),
          },
        );
        if (response.status === 204) return { revokedRemotely: true };
        return {
          revokedRemotely: false,
          reason: `GitHub grant revoke returned status ${response.status}`,
        };
      }

      // Slack's Web API (auth.revoke) always answers HTTP 200 and signals
      // failure via a JSON `ok` field -- trusting response.ok here would
      // silently report a failed revoke as successful.
      if (params.connector === "slack") {
        if (!params.endpoints.revokeUrl) {
          return {
            revokedRemotely: false,
            reason: "slack has no revoke endpoint; local invalidation only",
          };
        }
        const response = await fetch(params.endpoints.revokeUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${params.accessToken}`,
            "content-type": "application/x-www-form-urlencoded",
          },
        });
        const json = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (response.ok && json.ok === true) return { revokedRemotely: true };
        return {
          revokedRemotely: false,
          reason: `slack auth.revoke returned ${json.error ?? `HTTP status ${response.status}`}`,
        };
      }

      // HubSpot's legacy revoke endpoint deletes by REFRESH token in the URL
      // path (DELETE), not the access token in a request body. Without a
      // refresh token there is nothing to revoke against.
      if (params.connector === "hubspot") {
        if (!params.endpoints.revokeUrl) {
          return {
            revokedRemotely: false,
            reason: "hubspot has no revoke endpoint; local invalidation only",
          };
        }
        if (!params.refreshToken) {
          return {
            revokedRemotely: false,
            reason: "hubspot revoke requires a refresh token, none was stored; local invalidation only",
          };
        }
        const response = await fetch(
          `${params.endpoints.revokeUrl}${encodeURIComponent(params.refreshToken)}`,
          { method: "DELETE" },
        );
        if (response.status === 204) return { revokedRemotely: true };
        return {
          revokedRemotely: false,
          reason: `hubspot refresh-token revoke returned status ${response.status}`,
        };
      }

      if (!params.endpoints.revokeUrl) {
        return {
          revokedRemotely: false,
          reason: `${params.connector} has no revoke endpoint; local invalidation only`,
        };
      }

      const response = params.connector === "zendesk"
        ? await fetch(params.endpoints.revokeUrl, {
            method: "DELETE",
            headers: { authorization: `Bearer ${params.accessToken}` },
          })
        : await fetch(params.endpoints.revokeUrl, {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              ...(params.connector === "x"
                ? { authorization: `Basic ${Buffer.from(`${params.clientId}:${params.clientSecret}`).toString("base64")}` }
                : {}),
            },
            body: new URLSearchParams({
              token: params.accessToken,
              ...(params.connector === "x" ? { client_id: params.clientId } : {}),
            }).toString(),
          });
      if (response.ok) return { revokedRemotely: true };
      return {
        revokedRemotely: false,
        reason: `${params.connector} revoke endpoint returned status ${response.status}`,
      };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
