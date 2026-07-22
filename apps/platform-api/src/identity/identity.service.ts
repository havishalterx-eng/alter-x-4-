import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  IdentityProvider,
  MfaChallenge,
  MfaEnrollment,
  SessionRecord,
  SsoConfig,
} from "./identity-provider.interface";
import { IdentityHttpError } from "./problem";
import { hashToken, type SessionStore } from "./session-store";
import type { LoginDto } from "./dto/auth.dto";

export interface IssuedSession {
  userId: string;
  tenantId: string;
  accessToken: string;
  refreshToken: string;
  accessMaxAgeSeconds: number;
  refreshMaxAgeSeconds: number;
}

const accessMaxAgeSeconds = 15 * 60;
const refreshMaxAgeSeconds = 30 * 24 * 60 * 60;

@Injectable()
export class IdentityService {
  constructor(
    private readonly identityProvider: IdentityProvider,
    private readonly sessionStore: SessionStore,
  ) {}

  loginRedirectUrl(request: LoginDto): Promise<string> {
    return this.identityProvider.loginRedirectUrl(request);
  }

  async handleCallback(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    deviceInfo?: Record<string, unknown>;
    ip?: string;
  }): Promise<IssuedSession> {
    const identity = await this.identityProvider.handleCallback({
      code: input.code,
      redirectUri: input.redirectUri,
      codeVerifier: input.codeVerifier,
    });

    return this.issueSession(identity.userId, identity.tenantId, input.deviceInfo, input.ip);
  }

  async refreshSession(refreshToken: string): Promise<IssuedSession> {
    const previousHash = hashToken(refreshToken);
    const session = await this.sessionStore.findByRefreshTokenHash(previousHash);
    if (!session) {
      throw new IdentityHttpError(401, "INVALID_REFRESH_TOKEN", "Refresh token rejected");
    }

    const nextAccessToken = newToken();
    const nextRefreshToken = newToken();
    const rotated = await this.sessionStore.rotateRefreshToken(
      session.id,
      previousHash,
      hashToken(nextRefreshToken),
      hashToken(nextAccessToken),
    );

    if (!rotated) {
      throw new IdentityHttpError(401, "INVALID_REFRESH_TOKEN", "Refresh token rejected");
    }

    return {
      userId: session.userId,
      tenantId: session.tenantId,
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken,
      accessMaxAgeSeconds,
      refreshMaxAgeSeconds,
    };
  }

  async authenticateAccessToken(accessToken: string): Promise<SessionRecord> {
    const session = await this.sessionStore.findByAccessTokenHash(hashToken(accessToken));
    if (!session) {
      throw new IdentityHttpError(401, "INVALID_ACCESS_TOKEN", "Access token rejected");
    }

    return session;
  }

  listActiveSessions(userId: string): Promise<SessionRecord[]> {
    return this.sessionStore.listActive(userId);
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.sessionStore.revoke(userId, sessionId);
    await this.identityProvider.revokeSession(userId, sessionId);
  }

  enrollMfa(userId: string): Promise<MfaEnrollment> {
    return this.identityProvider.enrollMfa(userId);
  }

  challengeMfa(
    userId: string,
    enrollmentId: string,
    otp: string,
  ): Promise<MfaChallenge> {
    return this.identityProvider.challengeMfa(userId, enrollmentId, otp);
  }

  configureSso(tenantId: string, config: SsoConfig): Promise<SsoConfig> {
    return this.identityProvider.configureSso(tenantId, config);
  }

  private async issueSession(
    userId: string,
    tenantId: string,
    deviceInfo?: Record<string, unknown>,
    ip?: string,
  ): Promise<IssuedSession> {
    const accessToken = newToken();
    const refreshToken = newToken();

    const input: Parameters<SessionStore["create"]>[0] = {
      userId,
      tenantId,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
    };
    if (deviceInfo) {
      input.deviceInfo = deviceInfo;
    }
    if (ip) {
      input.ip = ip;
    }

    await this.sessionStore.create(input);

    return {
      userId,
      tenantId,
      accessToken,
      refreshToken,
      accessMaxAgeSeconds,
      refreshMaxAgeSeconds,
    };
  }
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}
