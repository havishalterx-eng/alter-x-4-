import type {
  AuthenticatedIdentity,
  CallbackRequest,
  IdentityProvider,
  LoginRedirectRequest,
  MfaChallenge,
  MfaEnrollment,
  SessionRecord,
  SsoConfig,
} from "../../identity-provider.interface";

export interface Auth0IdentityProviderOptions {
  domain: string;
  clientId: string;
  managementToken?: string;
  fetchImpl?: typeof fetch;
}

export class Auth0IdentityProvider implements IdentityProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly issuer: string;

  constructor(private readonly options: Auth0IdentityProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.issuer = `https://${options.domain}`;
  }

  async getOrCreateOrgForTenant(tenantId: string, name: string): Promise<string> {
    const existing = await this.managementJson<{ organizations: Array<{ id: string }> }>(
      `/api/v2/organizations?name=${encodeURIComponent(tenantId)}`,
    );
    const organization = existing.organizations.at(0);
    if (organization) {
      return organization.id;
    }

    const created = await this.managementJson<{ id: string }>("/api/v2/organizations", {
      method: "POST",
      body: JSON.stringify({
        name: tenantId,
        display_name: name,
        metadata: { alter_tenant_id: tenantId },
      }),
    });

    return created.id;
  }

  async loginRedirectUrl(request: LoginRedirectRequest): Promise<string> {
    const url = new URL(`${this.issuer}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", request.redirectUri);
    url.searchParams.set("scope", "openid profile email offline_access");
    url.searchParams.set("state", request.state);
    url.searchParams.set("code_challenge", request.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (request.organizationId) {
      url.searchParams.set("organization", request.organizationId);
    }
    if (request.connection) {
      url.searchParams.set("connection", request.connection);
    }

    return url.toString();
  }

  async handleCallback(request: CallbackRequest): Promise<AuthenticatedIdentity> {
    const token = await this.authJson<Auth0TokenResponse>("/oauth/token", {
      method: "POST",
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: this.options.clientId,
        code: request.code,
        redirect_uri: request.redirectUri,
        code_verifier: request.codeVerifier,
      }),
    });
    const profile = await this.authJson<Auth0Profile>("/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });

    return authenticatedIdentityFromProfile(profile);
  }

  async refreshSession(refreshToken: string): Promise<AuthenticatedIdentity> {
    const token = await this.authJson<Auth0TokenResponse>("/oauth/token", {
      method: "POST",
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: this.options.clientId,
        refresh_token: refreshToken,
      }),
    });
    const profile = await this.authJson<Auth0Profile>("/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });

    return authenticatedIdentityFromProfile(profile);
  }

  async listActiveSessions(_userId: string): Promise<SessionRecord[]> {
    void _userId;
    return [];
  }

  async revokeSession(_userId: string, _sessionId: string): Promise<void> {
    void _userId;
    void _sessionId;
  }

  async enrollMfa(userId: string): Promise<MfaEnrollment> {
    const enrollment = await this.managementJson<Auth0MfaEnrollment>(
      "/api/v2/guardian/enrollments/ticket",
      {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      },
    );

    return {
      enrollmentId: enrollment.ticket_id,
      barcodeUri: enrollment.ticket_url,
    };
  }

  async challengeMfa(
    userId: string,
    enrollmentId: string,
    otp: string,
  ): Promise<MfaChallenge> {
    const challenge = await this.authJson<{ id: string; status?: string }>("/mfa/challenge", {
      method: "POST",
      body: JSON.stringify({
        client_id: this.options.clientId,
        mfa_token: enrollmentId,
        challenge_type: "otp",
        otp,
        user_id: userId,
      }),
    });

    return {
      challengeId: challenge.id,
      status: challenge.status === "rejected" ? "rejected" : "pending",
    };
  }

  async configureSso(tenantId: string, config: SsoConfig): Promise<SsoConfig> {
    await this.managementJson(`/api/v2/organizations/${tenantId}`, {
      method: "PATCH",
      body: JSON.stringify({
        metadata: {
          sso_config_type: config.type,
        },
      }),
    });

    return config;
  }

  private async authJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.requestJson<T>(`${this.issuer}${path}`, init);
  }

  private async managementJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.options.managementToken) {
      throw new Error("Auth0 management token unavailable");
    }

    return this.requestJson<T>(`${this.issuer}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.options.managementToken}`,
        ...init.headers,
      },
    });
  }

  private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Auth0 request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }
}

interface Auth0TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
}

interface Auth0Profile {
  sub: string;
  email: string;
  name?: string;
  org_id: string;
  "https://alter.dev/user_id"?: string;
  "https://alter.dev/tenant_id"?: string;
}

interface Auth0MfaEnrollment {
  ticket_id: string;
  ticket_url: string;
}

function authenticatedIdentityFromProfile(profile: Auth0Profile): AuthenticatedIdentity {
  const identity: AuthenticatedIdentity = {
    userId: profile["https://alter.dev/user_id"] ?? profile.sub,
    tenantId: profile["https://alter.dev/tenant_id"] ?? profile.org_id,
    identityRef: profile.sub,
    email: profile.email,
  };
  if (profile.name) {
    identity.displayName = profile.name;
  }
  return identity;
}
