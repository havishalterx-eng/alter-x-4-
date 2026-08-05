export type SsoConfig =
  | {
      type: "saml";
      metadataUrl?: string;
      entityId?: string;
      certificateRef?: string;
    }
  | {
      type: "oidc";
      issuer: string;
      clientId: string;
      clientSecretRef?: string;
    };

export interface LoginRedirectRequest {
  tenantId?: string;
  organizationId?: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  connection?: "google-oauth2" | "Username-Password-Authentication";
}

export interface CallbackRequest {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export type DeviceTokenResult =
  | {
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
      tokenType: "Bearer";
    }
  | {
      error: "authorization_pending" | "slow_down" | "expired_token" | "access_denied";
    };

export interface AuthenticatedIdentity {
  userId: string;
  tenantId: string;
  identityRef: string;
  email: string;
  emailVerified: boolean;
  phoneVerified?: boolean;
  displayName?: string;
}

export interface MfaEnrollment {
  enrollmentId: string;
  barcodeUri?: string;
  recoveryCodes?: string[];
}

export interface MfaChallenge {
  challengeId: string;
  status: "pending" | "verified" | "rejected";
}

export interface IdentityProvider {
  getOrCreateOrgForTenant(tenantId: string, name: string): Promise<string>;
  loginRedirectUrl(request: LoginRedirectRequest): Promise<string>;
  handleCallback(request: CallbackRequest): Promise<AuthenticatedIdentity>;
  startDeviceAuthorization(): Promise<DeviceAuthorization>;
  pollDeviceToken(deviceCode: string): Promise<DeviceTokenResult>;
  refreshSession(refreshToken: string): Promise<AuthenticatedIdentity>;
  listActiveSessions(tenantId: string, userId: string): Promise<SessionRecord[]>;
  revokeSession(tenantId: string, userId: string, sessionId: string): Promise<void>;
  enrollMfa(userId: string): Promise<MfaEnrollment>;
  challengeMfa(
    userId: string,
    enrollmentId: string,
    otp: string,
  ): Promise<MfaChallenge>;
  configureSso(tenantId: string, config: SsoConfig): Promise<SsoConfig>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tenantId: string;
  deviceInfo?: Record<string, unknown>;
  ip?: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt?: Date;
}
