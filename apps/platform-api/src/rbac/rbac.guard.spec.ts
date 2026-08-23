import { Controller, Get, Module } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ActorContext,
  Public,
  RequirePermission,
  RequireStaffRole,
  RequireTenantRole,
  RequireWorkspaceRole,
} from "./decorators";
import {
  ParamWorkspaceResolver,
  WorkspaceLookupUnavailableError,
} from "./param-workspace.resolver";
import { RbacModule, resourceTenantResolverToken, resourceWorkspaceResolverToken } from "./rbac.module";
import type { ResourceTenantResolver } from "./resource-tenant.resolver";
import type { ActorContext as ActorContextType, StaffActorContext } from "./types";

// Fake honoring the ResourceTenantResolver interface directly -- this file
// tests RbacGuard's own route/role/mismatch logic in isolation, not
// WorkspaceResourceTenantResolver's real DB-backed lookup (see that
// class's own resource-tenant.resolver.spec.ts for that).
class FakeResourceTenantResolver implements ResourceTenantResolver {
  private readonly workspaceTenants: ReadonlyMap<string, string>;

  constructor(workspaceTenants: Record<string, string>) {
    this.workspaceTenants = new Map(Object.entries(workspaceTenants));
  }

  async resolveTenantId(request: { params?: Record<string, string | undefined> }): Promise<string | undefined> {
    const params = request.params ?? {};
    const directTenantId = params.tenantId ?? params.tenant_id;
    if (directTenantId) return directTenantId;
    const workspaceId = params.workspaceId ?? params.workspace_id;
    return workspaceId ? this.workspaceTenants.get(workspaceId) : undefined;
  }
}

const tenantA = "00000000-0000-7000-8000-000000000001";
const tenantB = "00000000-0000-7000-8000-000000000002";
// Both workspaces belong to tenantA on purpose: the pre-P5-1 spec mapped
// them to DIFFERENT tenants, which is exactly why it could only prove
// cross-TENANT denial and never caught the cross-workspace escalation.
const workspaceA = "00000000-0000-7000-8000-000000000101";
const workspaceB = "00000000-0000-7000-8000-000000000102";

@Controller("rbac-test")
class RbacTestController {
  @Public()
  @Get("public")
  publicRoute(): { ok: true } {
    return { ok: true };
  }

  @Get("default-deny")
  defaultDeny(): { ok: true } {
    return { ok: true };
  }

  @RequireTenantRole("owner")
  @Get("tenants/:tenantId/owner")
  tenantOwner(): { ok: true } {
    return { ok: true };
  }

  @RequireTenantRole("admin")
  @Get("tenants/:tenantId/admin")
  tenantAdmin(): { ok: true } {
    return { ok: true };
  }

  @RequireTenantRole("billing")
  @Get("tenants/:tenantId/billing")
  tenantBilling(): { ok: true } {
    return { ok: true };
  }

  @RequireTenantRole("member")
  @Get("tenants/:tenantId/member")
  tenantMember(): { ok: true } {
    return { ok: true };
  }

  @RequireWorkspaceRole("admin")
  @Get("workspaces/:workspaceId/admin")
  workspaceAdmin(): { ok: true } {
    return { ok: true };
  }

  @RequireWorkspaceRole("editor")
  @Get("workspaces/:workspaceId/editor")
  workspaceEditor(): { ok: true } {
    return { ok: true };
  }

  @RequireWorkspaceRole("operator")
  @Get("workspaces/:workspaceId/operator")
  workspaceOperator(): { ok: true } {
    return { ok: true };
  }

  @RequireWorkspaceRole("approver")
  @Get("workspaces/:workspaceId/approver")
  workspaceApprover(): { ok: true } {
    return { ok: true };
  }

  @RequireWorkspaceRole("viewer")
  @Get("workspaces/:workspaceId/viewer")
  workspaceViewer(): { ok: true } {
    return { ok: true };
  }

  // ENGINE-FIX-P5-1 regression surface: same shape as env-vars' routes --
  // a :projectId param with no workspace anywhere in the URL.
  @RequireWorkspaceRole("admin")
  @Get("projects/:projectId/admin")
  projectAdmin(): { ok: true } {
    return { ok: true };
  }

  @RequireTenantRole("member")
  @Get("actor")
  actor(@ActorContext() actorContext: ActorContextType): { userId: string } {
    return { userId: actorContext.user_id };
  }

  @RequireTenantRole("member")
  @RequirePermission("runs:read")
  @Get("permission")
  permission(): { ok: true } {
    return { ok: true };
  }

  @RequireStaffRole("staff_admin")
  @Get("staff/admin")
  staffAdmin(): { ok: true } {
    return { ok: true };
  }

  @RequireStaffRole("staff_admin", "staff_support", "staff_billing_ops", "staff_security")
  @Get("staff/any")
  staffAny(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [RbacModule],
  controllers: [RbacTestController],
})
class RbacTestModule {}

describe("RbacGuard", () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    // RbacModule now also registers ActorContextGuard (imports
    // IdentityModule/SignupModule), which validates real env at
    // DI-construction time. Every case here injects actorContext directly
    // via the x-test-actor header (below) rather than a real session
    // cookie, so ActorContextGuard itself never touches any of this --
    // these are only here to satisfy construction.
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
    process.env.MARKETPLACE_DATABASE_URL = "postgres://test:test@localhost:5432/test";
    process.env.IDENTITY_PROVIDER = "mock";
    process.env.SIGNING_KEY_PROVIDER = "mock";

    const moduleRef = await Test.createTestingModule({
      imports: [RbacTestModule],
    })
      .overrideProvider(resourceTenantResolverToken)
      .useValue(
        new FakeResourceTenantResolver({
          [workspaceA]: tenantA,
          [workspaceB]: tenantA,
        }),
      )
      // Direct workspaceId params resolve to themselves; no project lookup
      // in this file -- :projectId routes therefore exercise the documented
      // legacy flat path here, and the binding behavior is covered by the
      // workspaceId routes plus param-workspace.resolver.spec.ts.
      .overrideProvider(resourceWorkspaceResolverToken)
      .useValue(new ParamWorkspaceResolver())
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    attachActorHook(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.DATABASE_URL;
    delete process.env.MARKETPLACE_DATABASE_URL;
    delete process.env.IDENTITY_PROVIDER;
    delete process.env.SIGNING_KEY_PROVIDER;
  });

  it("denies unclassified routes by default", async () => {
    const response = await get("/rbac-test/default-deny", actor(["owner"], tenantA));

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error_code: "RBAC_ROLE_DENIED",
      status: 403,
      retryable: false,
      field_errors: [],
    });
  });

  it("checks tenant mismatch before role match", async () => {
    const response = await get(
      `/rbac-test/tenants/${tenantB}/owner`,
      actor(["owner"], tenantA),
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error_code: "RBAC_TENANT_MISMATCH",
      detail: "Access denied",
    });
  });

  it("allows explicit public routes without actor context", async () => {
    const response = await get("/rbac-test/public");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("injects actor context into controllers", async () => {
    const response = await get("/rbac-test/actor", actor(["member"], tenantA));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: "00000000-0000-7000-8000-000000000201" });
  });

  it("requires every declared permission after role authorization", async () => {
    const denied = await get(
      "/rbac-test/permission",
      actor(["member"], tenantA),
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error_code: "RBAC_PERMISSION_DENIED",
    });

    const allowedActor = actor(["member"], tenantA);
    allowedActor.permissions = ["runs:read"];
    const allowed = await get("/rbac-test/permission", allowedActor);
    expect(allowed.statusCode).toBe(200);
  });

  it("allows each explicit staff role without a tenant actor", async () => {
    for (const role of ["staff_admin", "staff_support", "staff_billing_ops", "staff_security"] as const) {
      const response = await get("/rbac-test/staff/any", undefined, staffActor(role));
      expect(response.statusCode).toBe(200);
    }
  });

  it("requires staff_admin for staff-admin routes", async () => {
    const denied = await get("/rbac-test/staff/admin", undefined, staffActor("staff_support"));
    const allowed = await get("/rbac-test/staff/admin", undefined, staffActor("staff_admin"));
    expect(denied.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
  });

  it("denies tenant actors on staff-only routes", async () => {
    const response = await get("/rbac-test/staff/any", actor(["owner"], tenantA));
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error_code: "RBAC_ROLE_DENIED" });
  });

  it("allows a matching workspace role and denies a non-matching one", async () => {
    const allowed = await get(
      `/rbac-test/workspaces/${workspaceA}/editor`,
      actor(["editor"], tenantA, workspaceA),
    );
    expect(allowed.statusCode).toBe(200);

    const denied = await get(
      `/rbac-test/workspaces/${workspaceA}/editor`,
      actor(["viewer"], tenantA, workspaceA),
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error_code: "RBAC_WORKSPACE_ROLE_DENIED" });
  });

  // ENGINE-FIX-P5-1: the escalation this fix exists for. Before it, an
  // admin of workspace A passed workspace B's admin gate inside the SAME
  // tenant, because roles were checked against the flat any-workspace
  // union. The spec previously could not even express this case: its two
  // workspaces belonged to different tenants.
  it("denies a role held in another workspace of the same tenant", async () => {
    const adminOfAOnly = actor(["admin"], tenantA, workspaceA);

    const own = await get(`/rbac-test/workspaces/${workspaceA}/admin`, adminOfAOnly);
    expect(own.statusCode).toBe(200);

    const other = await get(`/rbac-test/workspaces/${workspaceB}/admin`, adminOfAOnly);
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ error_code: "RBAC_WORKSPACE_ROLE_DENIED" });
  });

  it("denies when the actor holds no membership binding for the target workspace at all", async () => {
    const flatRoleOnly = actor(["editor"], tenantA, undefined);

    const response = await get(
      `/rbac-test/workspaces/${workspaceA}/editor`,
      flatRoleOnly,
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error_code: "RBAC_WORKSPACE_ROLE_DENIED" });
  });

  it("keeps the legacy flat-role behavior for routes with no resolvable workspace (documented)", async () => {
    const response = await get(
      "/rbac-test/projects/some-project/admin",
      actor(["admin"], tenantA, workspaceA),
    );

    expect(response.statusCode).toBe(200);
  });

  it("fails closed with RBAC_WORKSPACE_UNRESOLVABLE when workspace resolution errors on a bound route", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacTestModule],
    })
      .overrideProvider(resourceTenantResolverToken)
      .useValue(new FakeResourceTenantResolver({ [workspaceA]: tenantA }))
      .overrideProvider(resourceWorkspaceResolverToken)
      .useValue({
        resolveWorkspaceId: async () => {
          throw new WorkspaceLookupUnavailableError();
        },
      })
      .compile();
    const failingApp = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    attachActorHook(failingApp);
    await failingApp.init();
    await failingApp.getHttpAdapter().getInstance().ready();

    try {
      const response = await injectGet(failingApp, `/rbac-test/workspaces/${workspaceA}/admin`, actor(["admin"], tenantA, workspaceA));
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error_code: "RBAC_WORKSPACE_UNRESOLVABLE" });
    } finally {
      await failingApp.close();
    }
  });

  async function get(
    url: string,
    actorContext?: ActorContextType,
    staffContext?: StaffActorContext,
  ) {
    return injectGet(app, url, actorContext, staffContext);
  }
});

type InjectApp = {
  getHttpAdapter: () => { getInstance: () => { inject: (options: unknown) => Promise<{ statusCode: number; json: () => unknown }> } };
};

function attachActorHook(app: NestFastifyApplication): void {
  app.getHttpAdapter().getInstance().addHook("preHandler", (request, _reply, done) => {
    const actorHeader = request.headers["x-test-actor"];
    if (typeof actorHeader === "string") {
      (request as unknown as { actorContext?: ActorContextType }).actorContext = JSON.parse(
        actorHeader,
      ) as ActorContextType;
    }
    const staff = request.headers["x-test-staff"];
    if (typeof staff === "string") {
      (request as unknown as { staffActorContext?: StaffActorContext }).staffActorContext =
        JSON.parse(staff) as StaffActorContext;
    }
    done();
  });
}

async function injectGet(
  target: InjectApp,
  url: string,
  actorContext?: ActorContextType,
  staffContext?: StaffActorContext,
): Promise<{ statusCode: number; json: () => unknown }> {
  const options: { method: "GET"; url: string; headers?: Record<string, string> } = {
    method: "GET",
    url,
  };
  if (actorContext || staffContext) {
    options.headers = {};
    if (actorContext) {
      options.headers["x-test-actor"] = JSON.stringify(actorContext);
    }
    if (staffContext) {
      options.headers["x-test-staff"] = JSON.stringify(staffContext);
    }
  }
  return await target.getHttpAdapter().getInstance().inject(options);
}

function actor(
  roles: string[],
  tenantId: string,
  workspaceId?: string,
): ActorContextType {
  const context: ActorContextType = {
    user_id: "00000000-0000-7000-8000-000000000201",
    tenant_id: tenantId,
    roles,
    permissions: [],
    session_id: "00000000-0000-7000-8000-000000000301",
  };
  if (workspaceId) {
    context.workspace_id = workspaceId;
    // ENGINE-FIX-P5-1: structured bindings are what the guard now consults
    // for a resolved target workspace; the flat roles array alone no longer
    // grants workspace-scoped routes.
    context.workspaceRoles = roles.map((role) => ({ workspaceId, role }));
  }
  return context;
}

function staffActor(role: StaffActorContext["roles"][number]): StaffActorContext {
  return {
    staff_user_id: "stf_00000000-0000-7000-8000-000000000401",
    identity_ref: "auth0|staff-test",
    email: "staff@example.com",
    roles: [role],
  };
}
