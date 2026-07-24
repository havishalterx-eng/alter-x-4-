import { randomUUID } from "node:crypto";
import type { EntitlementProvider } from "../entitlements/entitlement-provider.interface";
import type { IdentityProvider } from "../identity/identity-provider.interface";
import type { IdentityService } from "../identity/identity.service";
import type { IdentityBrokerService } from "../identity-broker/identity-broker.service";
import type { IdempotencyStore } from "./idempotency-store";
import { PlatformHttpError } from "./problem";
import type { SignupLanding, SignupPersistence, SignupRequest } from "./types";

export class SignupService {
  constructor(
    private readonly identityProvider: IdentityProvider,
    private readonly identityService: IdentityService,
    private readonly identityBroker: IdentityBrokerService,
    private readonly entitlementProvider: EntitlementProvider,
    private readonly persistence: SignupPersistence,
    private readonly idempotency: IdempotencyStore,
  ) {}

  signup(request: SignupRequest): Promise<SignupLanding> {
    const payload = {
      code: request.code,
      redirectUri: request.redirectUri,
      codeVerifier: request.codeVerifier,
    };
    return this.idempotency.execute(request.idempotencyKey, payload, async () => {
      const identity = await this.identityProvider.handleCallback({
        code: request.code,
        redirectUri: request.redirectUri,
        codeVerifier: request.codeVerifier,
      });
      if (!identity.emailVerified) {
        throw new PlatformHttpError(
          403,
          "EMAIL_VERIFICATION_REQUIRED",
          "Email must be verified before signup can complete",
          "/api/v1/signup",
        );
      }

      const existing = await this.persistence.findExisting(
        identity.identityRef,
        identity.tenantId,
      );
      if (existing) {
        return this.landing(
          existing,
          true,
          request.deviceInfo,
          request.ip,
          undefined,
          existing.tenantRole,
          existing.workspaceRole,
        );
      }

      const userId = randomUUID();
      const tenantId = randomUUID();
      const workspaceId = randomUUID();
      const tenantName = `${identity.displayName ?? identity.email.split("@")[0] ?? "Personal"}'s Workspace`;
      const identityOrgRef = await this.identityProvider.getOrCreateOrgForTenant(
        tenantId,
        tenantName,
      );

      const entitlement = await this.persistence.createSignup(
        {
          userId,
          tenantId,
          workspaceId,
          identityRef: identity.identityRef,
          email: identity.email,
          ...(identity.displayName ? { displayName: identity.displayName } : {}),
          tenantName,
          identityOrgRef,
        },
        (client) =>
          this.entitlementProvider.createEntitlement(tenantId, "free", client),
      );

      return this.landing(
        { userId, tenantId, workspaceId },
        false,
        request.deviceInfo,
        request.ip,
        entitlement,
      );
    });
  }

  private async landing(
    ids: { userId: string; tenantId: string; workspaceId: string },
    returning: boolean,
    deviceInfo?: Record<string, unknown>,
    ip?: string,
    createdEntitlement?: Awaited<ReturnType<EntitlementProvider["createEntitlement"]>>,
    tenantRole = "owner",
    workspaceRole = "admin",
  ): Promise<SignupLanding> {
    const entitlement =
      createdEntitlement ??
      (await this.entitlementProvider.getEffectiveEntitlement(ids.tenantId));
    const session = await this.identityService.issueSignupSession(
      ids.userId,
      ids.tenantId,
      deviceInfo,
      ip,
    );
    const actorToken = await this.identityBroker.mintActorToken({
      userId: ids.userId,
      tenantId: ids.tenantId,
      workspaceId: ids.workspaceId,
      roles: [tenantRole, workspaceRole],
      permissions: [],
      sessionId: session.sessionId,
      authTime: Math.floor(Date.now() / 1000),
      callingTenantId: ids.tenantId,
    });

    return {
      returning,
      ...ids,
      tenantRole,
      workspaceRole,
      onboardingStatus: "not_started",
      entitlement,
      actorToken,
      session,
    };
  }
}
