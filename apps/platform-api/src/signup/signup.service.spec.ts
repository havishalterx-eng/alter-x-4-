import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalFileConfigProvider } from "../entitlements/adapters/local-file/local-file-config-provider";
import type { EntitlementStore } from "../entitlements/entitlement-store";
import { InternalEntitlementProvider } from "../entitlements/internal-entitlement-provider";
import type { IdentityProvider } from "../identity/identity-provider.interface";
import type { IdentityService } from "../identity/identity.service";
import type { IdentityBrokerService } from "../identity-broker/identity-broker.service";
import { ProcessLocalSignupIdempotencyStore } from "./idempotency-store";
import { SignupService } from "./signup.service";
import type {
  CreateSignupInput,
  ExistingSignup,
  SignupPersistence,
} from "./types";

const freeLimits = {
  maxWorkflows: 3,
  maxProjects: 1,
  maxRunsPerDay: 10,
  maxConcurrentRuns: 1,
  maxSandboxMinutesPerMonth: 30,
  maxAdsStorageMb: 500,
  maxIntegrations: 3,
};

class MemoryPersistence implements SignupPersistence {
  existing: ExistingSignup | null = null;
  rows: CreateSignupInput[] = [];

  async findExisting(): Promise<ExistingSignup | null> {
    return this.existing;
  }

  async createSignup<T>(
    input: CreateSignupInput,
    beforeCommit: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const snapshot = [...this.rows];
    this.rows.push(input);
    try {
      return await beforeCommit({} as PoolClient);
    } catch (error) {
      this.rows = snapshot;
      throw error;
    }
  }
}

function setup(
  options: {
    verified?: boolean;
    entitlementFails?: boolean;
    displayName?: string | null;
  } = {},
) {
  const identityProvider = {
    handleCallback: vi.fn().mockResolvedValue({
      userId: "auth0|external",
      tenantId: "00000000-0000-7000-8000-000000000001",
      identityRef: "auth0|external",
      email: "new.user@example.com",
      emailVerified: options.verified ?? true,
      ...(options.displayName === null
        ? {}
        : { displayName: options.displayName ?? "New User" }),
    }),
    getOrCreateOrgForTenant: vi.fn().mockResolvedValue("org_new"),
  } as unknown as IdentityProvider;
  const identityService = {
    issueSignupSession: vi.fn().mockResolvedValue({
      sessionId: "signup-session",
      userId: "platform-user",
      tenantId: "platform-tenant",
      accessToken: "access",
      refreshToken: "refresh",
      accessMaxAgeSeconds: 900,
      refreshMaxAgeSeconds: 2_592_000,
    }),
  } as unknown as IdentityService;
  const identityBroker = {
    mintActorToken: vi.fn().mockImplementation(async (input) => ({
      token: "actor.jwt",
      claims: {
        user_id: input.userId,
        tenant_id: input.tenantId,
        workspace_id: input.workspaceId,
        roles: input.roles,
        permissions: [],
        session_id: input.sessionId,
        auth_time: input.authTime,
        jti: "jti",
        iss: "issuer",
        aud: "alter-engine",
        iat: 1,
        exp: 301,
      },
    })),
  } as unknown as IdentityBrokerService;
  const entitlementRows: Array<{
    tenantId: string;
    plan: string;
    limits: null;
  }> = [];
  const entitlementStore: EntitlementStore = {
    findEffective: vi.fn().mockImplementation(async (tenantId) =>
      entitlementRows.find((row) => row.tenantId === tenantId) ?? null,
    ),
    create: vi.fn().mockImplementation(async (tenantId, plan) => {
      if (options.entitlementFails) throw new Error("entitlement failed");
      const row = { tenantId, plan, limits: null };
      entitlementRows.push(row);
      return row;
    }),
  };
  const entitlementProvider = new InternalEntitlementProvider(
    entitlementStore,
    new LocalFileConfigProvider(),
  );
  const persistence = new MemoryPersistence();
  const service = new SignupService(
    identityProvider,
    identityService,
    identityBroker,
    entitlementProvider,
    persistence,
    new ProcessLocalSignupIdempotencyStore(),
  );
  return {
    service,
    persistence,
    identityProvider,
    identityService,
    identityBroker,
    entitlementStore,
  };
}

const request = {
  code: "auth-code",
  redirectUri: "https://app.test/callback",
  codeVerifier: "verifier",
  idempotencyKey: "signup-1",
};

describe("SignupService", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates atomic personal tenant landing with exact free limits", async () => {
    const { service, persistence, entitlementStore, identityBroker } = setup();
    const landing = await service.signup(request);

    expect(landing).toMatchObject({
      returning: false,
      tenantRole: "owner",
      workspaceRole: "admin",
      onboardingStatus: "not_started",
      entitlement: { plan: "free", limits: freeLimits },
      actorToken: { token: "actor.jwt" },
    });
    expect(persistence.rows).toHaveLength(1);
    expect(persistence.rows[0]).toMatchObject({
      tenantName: "New User's Workspace",
      identityOrgRef: "org_new",
    });
    expect(entitlementStore.create).toHaveBeenCalledWith(
      landing.tenantId,
      "free",
      expect.anything(),
    );
    expect(identityBroker.mintActorToken).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: landing.tenantId,
        workspaceId: landing.workspaceId,
        roles: ["owner", "admin"],
        sessionId: "signup-session",
      }),
    );
  });

  it("rolls back all platform rows when entitlement creation fails", async () => {
    const { service, persistence, identityService } = setup({ entitlementFails: true });
    await expect(service.signup(request)).rejects.toThrow("entitlement failed");
    expect(persistence.rows).toEqual([]);
    expect(identityService.issueSignupSession).not.toHaveBeenCalled();
  });

  it("returns existing landing without creating another tenant", async () => {
    const { service, persistence, identityProvider } = setup();
    persistence.existing = {
      userId: "existing-user",
      tenantId: "existing-tenant",
      workspaceId: "existing-workspace",
      tenantRole: "member",
      workspaceRole: "viewer",
    };
    const landing = await service.signup(request);
    expect(landing.returning).toBe(true);
    expect(landing.tenantId).toBe("existing-tenant");
    expect(landing.tenantRole).toBe("member");
    expect(landing.actorToken.claims.roles).toEqual(["member", "viewer"]);
    expect(persistence.rows).toEqual([]);
    expect(identityProvider.getOrCreateOrgForTenant).not.toHaveBeenCalled();
  });

  it("replays same idempotency key and creates one tenant", async () => {
    const { service, persistence, identityProvider } = setup();
    const first = await service.signup(request);
    const second = await service.signup(request);
    expect(second).toBe(first);
    expect(persistence.rows).toHaveLength(1);
    expect(identityProvider.handleCallback).toHaveBeenCalledOnce();
  });

  it("rejects same idempotency key with changed request", async () => {
    const { service } = setup();
    await service.signup(request);
    await expect(
      service.signup({ ...request, code: "different-code" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("blocks unverified email before platform writes", async () => {
    const { service, persistence } = setup({ verified: false });
    await expect(service.signup(request)).rejects.toMatchObject({ status: 403 });
    expect(persistence.rows).toEqual([]);
  });

  it("derives tenant name from email when display name is absent", async () => {
    const { service, persistence } = setup({ displayName: null });
    await service.signup(request);
    expect(persistence.rows[0]?.tenantName).toBe("new.user's Workspace");
  });
});
