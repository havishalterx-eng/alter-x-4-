import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RbacExceptionFilter, RbacModule, type ActorContextType, type RbacRequest } from "../rbac";
import { StaffService } from "./staff.service";
import { SupportAccessController } from "./support-access.controller";

const admin: ActorContextType = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: "00000000-0000-7000-8000-000000000001",
  session_id: "ses_018f47a5-7b2c-7d10-8f11-123456789abc",
  roles: ["admin"],
  permissions: [],
};

describe("SupportAccessController", () => {
  let app: NestFastifyApplication;
  const staff = { listForTenant: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [SupportAccessController],
      providers: [
        { provide: StaffService, useValue: staff },
        { provide: APP_FILTER, useClass: RbacExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.getHttpAdapter().getInstance().addHook("preHandler", (request: FastifyRequest, _reply, done) => {
      const actor = request.headers["x-test-actor"];
      if (typeof actor === "string") (request as RbacRequest).actorContext = JSON.parse(actor) as ActorContextType;
      done();
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => staff.listForTenant.mockReset());
  afterAll(async () => app.close());

  it("uses only the authenticated tenant and returns role-only staff transparency", async () => {
    staff.listForTenant.mockResolvedValue({
      data: [{
        id: "jit_018f47a5-7b2c-7d10-8f11-123456789abc",
        reason_code: "support_case",
        reason_text: "Investigate case #42",
        granted_at: new Date("2026-08-05T10:00:00.000Z"),
        expires_at: new Date("2026-08-05T11:00:00.000Z"),
        revoked_at: null,
        staff_roles: ["staff_support"],
      }],
      page: { next_cursor: null, has_more: false, limit: 50 },
    });

    const response = await request("/api/v1/support-access/grants?tenant_id=other", admin);
    expect(response.statusCode).toBe(400);
    expect(staff.listForTenant).not.toHaveBeenCalled();

    const valid = await request("/api/v1/support-access/grants", admin);
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({
      data: [{
        id: "jit_018f47a5-7b2c-7d10-8f11-123456789abc",
        reason_code: "support_case",
        reason_text: "Investigate case #42",
        granted_at: "2026-08-05T10:00:00.000Z",
        expires_at: "2026-08-05T11:00:00.000Z",
        revoked_at: null,
        staff_roles: ["staff_support"],
      }],
      page: { next_cursor: null, has_more: false, limit: 50 },
    });
    expect(staff.listForTenant).toHaveBeenCalledWith(admin.tenant_id, { limit: 50 });
  });

  it("denies non-admin tenant actors", async () => {
    const response = await request("/api/v1/support-access/grants", { ...admin, roles: ["member"] });
    expect(response.statusCode).toBe(403);
    expect(staff.listForTenant).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid opaque cursor", async () => {
    const response = await request("/api/v1/support-access/grants?cursor=not-a-cursor", admin);
    expect(response.statusCode).toBe(400);
    expect(staff.listForTenant).not.toHaveBeenCalled();
  });

  function request(url: string, actor: ActorContextType): Promise<{ statusCode: number; json(): unknown }> {
    return app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url,
      headers: { "x-test-actor": JSON.stringify(actor) },
    }) as Promise<{ statusCode: number; json(): unknown }>;
  }
});
