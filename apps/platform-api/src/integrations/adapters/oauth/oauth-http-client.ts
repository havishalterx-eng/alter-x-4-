import { createHash, randomBytes } from "node:crypto";
import type { ConnectorDefinition, ConnectorId } from "../../connectors";

export interface TokenExchangeParams {
  readonly connector: ConnectorId;
  readonly definition: ConnectorDefinition;
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
  readonly definition: ConnectorDefinition;
  readonly accessToken: string;
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
        client_secret: params.clientSecret,
      });
      if (params.codeVerifier) body.set("code_verifier", params.codeVerifier);
      const response = await fetch(params.definition.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
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
      const response = await fetch(userInfoUrl, {
        headers: {
          authorization: `Bearer ${accessToken}`,
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
      const accountId = json.id ?? json.sub ?? json.login;
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

      if (!params.definition.revokeUrl) {
        return {
          revokedRemotely: false,
          reason: `${params.connector} has no revoke endpoint; local invalidation only`,
        };
      }

      const response = await fetch(params.definition.revokeUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: params.accessToken }).toString(),
      });
      if (response.ok) return { revokedRemotely: true };
      return {
        revokedRemotely: false,
        reason: `${params.connector} revoke endpoint returned status ${response.status}`,
      };
    },
  };
}
