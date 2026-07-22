import { Controller, Get, Module } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActorContext, Public, RequireTenantRole, RequireWorkspaceRole } from "./decorators";
import { RbacModule, resourceTenantResolverToken } from "./rbac.module";
import { RequestParamTenantResolver } from "./resource-tenant.resolver";
import type { ActorContext as ActorContextType, TenantRole } from "./types";
import { tenantRoles, workspaceRoles } from "./types";

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
}

@Module({
  imports: [RbacModule],
  controllers: [RbacTestController],
})
class RbacTestModule {}

describe("RbacGuard", () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacTestModule],
    })
      .overrideProvider(resourceTenantResolverToken)
      .useValue(
        new RequestParamTenantResolver({
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
      done();
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(tenantRoles.flatMap((actual) => tenantRoles.map((required) => [actual, required])))(
    "checks tenant role %s against requirement %s",
    async (actual, required) => {
      const response = await get(
        `/rbac-test/tenants/${tenantA}/${required}`,
        actor([actual], tenantA),
      );

      expect(response.statusCode).toBe(tenantRoleExpectedStatus(actual, required));
    },
  );

  it.each(
    workspaceRoles.flatMap((actual) =>
      workspaceRoles.map((required) => [actual, required]),
    ),
  )("checks workspace role %s against requirement %s", async (actual, required) => {
    const response = await get(
      `/rbac-test/workspaces/${workspaceA}/${required}`,
      actor([actual], tenantA, workspaceA),
    );

    expect(response.statusCode).toBe(actual === required ? 200 : 403);
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

  async function get(url: string, actorContext?: ActorContextType) {
    const options: { method: "GET"; url: string; headers?: Record<string, string> } = {
      method: "GET",
      url,
    };
    if (actorContext) {
      options.headers = { "x-test-actor": JSON.stringify(actorContext) };
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

function tenantRoleExpectedStatus(actual: TenantRole, required: TenantRole): number {
  const ranks: Record<TenantRole, number> = {
    owner: 4,
    admin: 3,
    billing: 2,
    member: 1,
  };

  return ranks[actual] >= ranks[required] ? 200 : 403;
}
