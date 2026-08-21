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
import { RbacModule, resourceTenantResolverToken } from "./rbac.module";
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
          [workspaceB]: tenantB,
        }),
      )
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.getHttpAdapter().getInstance().addHook("preHandler", (request, _reply, done) => {
      const actor = request.headers["x-test-actor"];
      if (typeof actor === "string") {
        (request as unknown as { actorContext?: ActorContextType }).actorContext = JSON.parse(
          actor,
        ) as ActorContextType;
      }
      const staff = request.headers["x-test-staff"];
      if (typeof staff === "string") {
        (request as unknown as { staffActorContext?: StaffActorContext }).staffActorContext =
          JSON.parse(staff) as StaffActorContext;
      }
      done();
    });
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
    expect(denied.json()).toMatchObject({ error_code: "RBAC_ROLE_DENIED" });
  });

  async function get(
    url: string,
    actorContext?: ActorContextType,
    staffContext?: StaffActorContext,
  ) {
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
    return await app.getHttpAdapter().getInstance().inject(options);
  }
});

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
