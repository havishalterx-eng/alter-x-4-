import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { RbacDeniedError } from "../../../apps/platform-api/src/rbac/problem";
import { ParamWorkspaceResolver } from "../../../apps/platform-api/src/rbac/param-workspace.resolver";
import { RbacGuard } from "../../../apps/platform-api/src/rbac/rbac.guard";
import type { ResourceTenantResolver } from "../../../apps/platform-api/src/rbac/resource-tenant.resolver";
import {
  tenantRoles,
  workspaceRoles,
  type ActorContext,
  type RbacRequest,
  type TenantRole,
} from "../../../apps/platform-api/src/rbac/types";

// This exercises RbacGuard's own role/mismatch logic directly, not
// WorkspaceResourceTenantResolver's real DB-backed lookup (which has its
// own dedicated spec in apps/platform-api/src/rbac/) -- a fake honoring
// the interface with a fixed workspace->tenant mapping is what these
// cases actually need.
class FakeResourceTenantResolver implements ResourceTenantResolver {
  private readonly workspaceTenants: ReadonlyMap<string, string>;

  constructor(workspaceTenants: Record<string, string>) {
    this.workspaceTenants = new Map(Object.entries(workspaceTenants));
  }

  async resolveTenantId(request: RbacRequest): Promise<string | undefined> {
    const params = request.params ?? {};
    const directTenantId = params.tenantId ?? params.tenant_id;
    if (directTenantId) return directTenantId;
    const workspaceId = params.workspaceId ?? params.workspace_id;
    return workspaceId ? this.workspaceTenants.get(workspaceId) : undefined;
  }
}

const tenantA = "00000000-0000-7000-8000-000000000001";
const tenantB = "00000000-0000-7000-8000-000000000002";
const workspaceA = "00000000-0000-7000-8000-000000000101";
const workspaceB = "00000000-0000-7000-8000-000000000102";

describe("RBAC integration isolation", () => {
  it.each(tenantRoles.flatMap((actual) => tenantRoles.map((required) => [actual, required])))(
    "checks tenant role %s against requirement %s",
    async (actual, required) => {
      const result = canActivate({
        actorContext: actor([actual], tenantA),
        params: { tenantId: tenantA },
        requiredTenantRoles: [required],
      });

      if (tenantRoleExpectedStatus(actual, required) === 200) {
        await expect(result).resolves.toBe(true);
      } else {
        await expect(result).rejects.toMatchObject({
          problem: {
            error_code: "RBAC_ROLE_DENIED",
            status: 403,
            retryable: false,
            field_errors: [],
          },
        });
      }
    },
  );

  it.each(
    workspaceRoles.flatMap((actual) =>
      workspaceRoles.map((required) => [actual, required]),
    ),
  )("checks workspace role %s against requirement %s", async (actual, required) => {
    const result = canActivate({
      actorContext: actor([actual], tenantA, workspaceA),
      params: { workspaceId: workspaceA },
      requiredWorkspaceRoles: [required],
    });

    if (actual === required) {
      await expect(result).resolves.toBe(true);
    } else {
      // ENGINE-FIX-P5-1: the route's resolved target workspace now requires
      // the role from the actor's binding FOR THAT workspace, so a
      // mismatched role is a workspace-scoped denial, not the flat
      // RBAC_ROLE_DENIED.
      await expect(result).rejects.toMatchObject({
        problem: { error_code: "RBAC_WORKSPACE_ROLE_DENIED", status: 403 },
      });
    }
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
    new FakeResourceTenantResolver({
      [workspaceA]: tenantA,
      [workspaceB]: tenantB,
    }),
    // Direct workspaceId params resolve to themselves; no project lookup
    // is needed for these cases.
    new ParamWorkspaceResolver(),
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
    // ENGINE-FIX-P5-1: the guard consults these structured bindings for a
    // resolved target workspace; the flat array alone no longer grants
    // workspace-scoped routes.
    context.workspaceRoles = roles.map((role) => ({ workspaceId, role }));
  }
  return context;
}

function tenantRoleExpectedStatus(actual: TenantRole, required: TenantRole): number {
  const ranks: Record<TenantRole, number> = {
    owner: 4,
    admin: 3,
    billing: 2,
    member: 1,
  };

  return ranks[actual] >= ranks[required] ? 200 : 403;
}
