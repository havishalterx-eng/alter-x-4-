import { APP_FILTER } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  RbacExceptionFilter,
  RbacModule,
  type ActorContextType,
  type RbacRequest,
} from "../rbac";
import { resourceTenantResolverToken } from "../rbac/rbac.module";
import type { ResourceTenantResolver } from "../rbac/resource-tenant.resolver";
import { I18nController } from "./i18n.controller";
import { I18nExceptionFilter } from "./i18n-exception.filter";
import { I18nService } from "./i18n.service";

const actor: ActorContextType = {
  user_id: "00000000-0000-7000-8000-000000000011",
  tenant_id: "00000000-0000-7000-8000-000000000001",
  workspace_id: "00000000-0000-7000-8000-000000000021",
  roles: ["admin"],
  permissions: [],
  session_id: "session-i18n",
  // ENGINE-FIX-P5-1: the guard now answers @RequireWorkspaceRole for a
  // resolved workspaceId from these structured bindings, not the flat
  // roles array.
  workspaceRoles: [{ workspaceId: "00000000-0000-7000-8000-000000000021", role: "admin" }],
};

// ENGINE-FIX-P3-21: this controller's PATCH workspaces/:workspaceId/language
// route is the only one in this app whose URL carries a real workspaceId
// param, so it's the only controller spec that needs to stand in for
// WorkspaceResourceTenantResolver's real DB-backed lookup -- this file
// mocks I18nService entirely and has no other reason to touch Postgres.
// Same fake-resolver treatment as rbac.guard.spec.ts.
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

describe("i18n routes", () => {
  let app: NestFastifyApplication;
  const service = {
    getBundle: vi.fn().mockResolvedValue({
      locale: "hi",
      namespace: "ui",
      messages: { "language.hindi": "हिन्दी" },
    }),
    updateUserLanguage: vi.fn().mockResolvedValue({ language: "hi" }),
    updateWorkspaceLanguage: vi.fn().mockResolvedValue({ language: "hi" }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [I18nController],
      providers: [
        { provide: I18nService, useValue: service },
        I18nExceptionFilter,
        { provide: APP_FILTER, useClass: RbacExceptionFilter },
      ],
    })
      .overrideProvider(resourceTenantResolverToken)
      .useValue(
        new FakeResourceTenantResolver({
          [actor.workspace_id ?? ""]: actor.tenant_id,
        }),
      )
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.getHttpAdapter().getInstance().addHook(
      "preHandler",
      (request: FastifyRequest, _reply: unknown, done: () => void) => {
        const value = request.headers["x-test-actor"];
        if (typeof value === "string") {
          (request as RbacRequest).actorContext = JSON.parse(value) as ActorContextType;
        }
        done();
      },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the seeded EN/HI bundle lookup contract", async () => {
    const response = await request("GET", "/api/v1/i18n/bundles/hi/ui", actor);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      locale: "hi",
      namespace: "ui",
      messages: { "language.hindi": "हिन्दी" },
    });
    expect(service.getBundle).toHaveBeenCalledWith("hi", "ui", actor.tenant_id);
  });

  it("allows a member to update only their own language preference", async () => {
    const response = await request(
      "PATCH",
      "/api/v1/i18n/users/me/language",
      { ...actor, roles: ["member"] },
      { language: "hi" },
    );
    expect(response.statusCode).toBe(200);
    expect(service.updateUserLanguage).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: actor.user_id }),
      "hi",
    );
  });

  it("rejects workspace changes from a non-admin while allowing an admin", async () => {
    const denied = await request(
      "PATCH",
      `/api/v1/i18n/workspaces/${actor.workspace_id}/language`,
      {
        ...actor,
        roles: ["viewer"],
        // ENGINE-FIX-P5-1: the structured binding is what the guard
        // consults for the resolved workspace, so the downgraded actor's
        // binding must be downgraded with it.
        workspaceRoles: [
          { workspaceId: "00000000-0000-7000-8000-000000000021", role: "viewer" },
        ],
      },
      { language: "hi" },
    );
    expect(denied.statusCode).toBe(403);

    const allowed = await request(
      "PATCH",
      `/api/v1/i18n/workspaces/${actor.workspace_id}/language`,
      actor,
      { language: "hi" },
    );
    expect(allowed.statusCode).toBe(200);
    expect(service.updateWorkspaceLanguage).toHaveBeenCalledWith(
      actor,
      actor.workspace_id,
      "hi",
    );
  });

  async function request(
    method: "GET" | "PATCH",
    url: string,
    requestActor: ActorContextType,
    payload?: object,
  ) {
    const headers = { "x-test-actor": JSON.stringify(requestActor) };
    if (payload !== undefined) {
      return app.inject({ method, url, payload, headers });
    }
    return app.inject({
      method,
      url,
      headers,
    });
  }
});
