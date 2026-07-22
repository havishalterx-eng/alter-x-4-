import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { RbacDeniedError } from "../../../apps/platform-api/src/rbac/problem";
import { RbacGuard } from "../../../apps/platform-api/src/rbac/rbac.guard";
import { RequestParamTenantResolver } from "../../../apps/platform-api/src/rbac/resource-tenant.resolver";
import type { ActorContext, RbacRequest } from "../../../apps/platform-api/src/rbac/types";

const tenantA = "00000000-0000-7000-8000-000000000001";
const tenantB = "00000000-0000-7000-8000-000000000002";
const workspaceA = "00000000-0000-7000-8000-000000000101";
const workspaceB = "00000000-0000-7000-8000-000000000102";

describe("RBAC integration isolation", () => {
  it("passes with right tenant and right tenant role", async () => {
    await expect(
      canActivate({
        actorContext: actor(["admin"], tenantA),
        params: { tenantId: tenantA },
        requiredTenantRoles: ["admin"],
      }),
    ).resolves.toBe(true);
  });

  it("denies right tenant with wrong role", async () => {
    await expect(
      canActivate({
        actorContext: actor(["member"], tenantA),
        params: { tenantId: tenantA },
        requiredTenantRoles: ["admin"],
      }),
    ).rejects.toMatchObject({
      problem: {
        error_code: "RBAC_ROLE_DENIED",
        status: 403,
        retryable: false,
        field_errors: [],
      },
    });
  });

  it("denies wrong tenant before role check", async () => {
    await expect(
      canActivate({
        actorContext: actor(["admin"], tenantA),
        params: { tenantId: tenantB },
        requiredTenantRoles: ["admin"],
      }),
    ).rejects.toMatchObject({
      problem: {
        error_code: "RBAC_TENANT_MISMATCH",
        detail: "Access denied",
      },
    });
  });

  it("denies wrong workspace tenant before workspace role check", async () => {
    await expect(
      canActivate({
        actorContext: actor(["approver"], tenantA, workspaceA),
        params: { workspaceId: workspaceB },
        requiredWorkspaceRoles: ["approver"],
      }),
    ).rejects.toMatchObject({
      problem: {
        error_code: "RBAC_TENANT_MISMATCH",
      },
    });
  });

  it("passes workspace role with same tenant", async () => {
    await expect(
      canActivate({
        actorContext: actor(["approver"], tenantA, workspaceA),
        params: { workspaceId: workspaceA },
        requiredWorkspaceRoles: ["approver"],
      }),
    ).resolves.toBe(true);
  });

  it("denies unclassified route by default", async () => {
    await expect(
      canActivate({
        actorContext: actor(["owner"], tenantA),
        params: { tenantId: tenantA },
      }),
    ).rejects.toBeInstanceOf(RbacDeniedError);
  });

  it("allows public routes without actor context", async () => {
    await expect(canActivate({ publicRoute: true })).resolves.toBe(true);
  });
});

interface GuardCase {
  actorContext?: ActorContext;
  params?: Record<string, string>;
  requiredTenantRoles?: string[];
  requiredWorkspaceRoles?: string[];
  publicRoute?: boolean;
}

async function canActivate(testCase: GuardCase): Promise<boolean> {
  const handler = () => undefined;
  const controller = class TestController {};
  const guard = new RbacGuard(
    reflectorFor(testCase),
    new RequestParamTenantResolver({
      [workspaceA]: tenantA,
      [workspaceB]: tenantB,
    }),
  );
  const request: RbacRequest = { url: "/integration-rbac/test" };
  if (testCase.actorContext) {
    request.actorContext = testCase.actorContext;
  }
  if (testCase.params) {
    request.params = testCase.params;
  }

  return guard.canActivate({
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext);
}

function reflectorFor(testCase: GuardCase): Reflector {
  return {
    getAllAndOverride: (metadataKey: unknown) => {
      const key = String(metadataKey);
      if (key.includes("public-route")) {
        return testCase.publicRoute;
      }
      if (key.includes("tenant-roles")) {
        return testCase.requiredTenantRoles;
      }
      if (key.includes("workspace-roles")) {
        return testCase.requiredWorkspaceRoles;
      }
      return undefined;
    },
  } as unknown as Reflector;
}

function actor(roles: string[], tenantId: string, workspaceId?: string): ActorContext {
  const context: ActorContext = {
    user_id: "00000000-0000-7000-8000-000000000201",
    tenant_id: tenantId,
    roles,
    permissions: [],
    session_id: "00000000-0000-7000-8000-000000000301",
  };
  if (workspaceId) {
    context.workspace_id = workspaceId;
  }
  return context;
}
