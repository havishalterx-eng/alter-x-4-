import { randomUUID } from "node:crypto";
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

export class MockIdentityProvider implements IdentityProvider {
  private readonly orgs = new Map<string, string>();
  private readonly ssoConfigs = new Map<string, SsoConfig>();
  private readonly identities = new Map<string, AuthenticatedIdentity>();

  async getOrCreateOrgForTenant(tenantId: string, name: string): Promise<string> {
    const existing = this.orgs.get(tenantId);
    if (existing) {
      return existing;
    }

    const orgId = `org_${name.toLowerCase().replaceAll(/\s+/g, "_")}_${tenantId.slice(0, 8)}`;
    this.orgs.set(tenantId, orgId);
    return orgId;
  }

  async loginRedirectUrl(request: LoginRedirectRequest): Promise<string> {
    const url = new URL("https://mock.identity.local/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", "mock-client");
    url.searchParams.set("redirect_uri", request.redirectUri);
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
    const userId = request.code.startsWith("user:")
      ? request.code.slice("user:".length)
      : "00000000-0000-7000-8000-000000000101";
    const tenantId = "00000000-0000-7000-8000-000000000001";
    const identity = {
      userId,
      tenantId,
      identityRef: `auth0|${userId}`,
      email: "mock.user@example.com",
      displayName: "Mock User",
    };

    this.identities.set(userId, identity);
    return identity;
  }

  async refreshSession(_refreshToken: string): Promise<AuthenticatedIdentity> {
    void _refreshToken;
    return {
      userId: "00000000-0000-7000-8000-000000000101",
      tenantId: "00000000-0000-7000-8000-000000000001",
      identityRef: "auth0|00000000-0000-7000-8000-000000000101",
      email: "mock.user@example.com",
      displayName: "Mock User",
    };
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
    return {
      enrollmentId: `mfa_${userId.slice(0, 8)}_${randomUUID()}`,
      barcodeUri: "otpauth://totp/Alter:mock.user@example.com",
      recoveryCodes: ["mock-recovery-code"],
    };
  }

  async challengeMfa(
    _userId: string,
    enrollmentId: string,
    otp: string,
  ): Promise<MfaChallenge> {
    return {
      challengeId: `chal_${enrollmentId}`,
      status: otp === "000000" ? "rejected" : "verified",
    };
  }

  async configureSso(tenantId: string, config: SsoConfig): Promise<SsoConfig> {
    this.ssoConfigs.set(tenantId, config);
    return config;
  }
}
