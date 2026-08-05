import { createHash } from "node:crypto";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AUDIT_STORE_PROVIDER, createMockAuditStoreProvider, type SecretsProvider } from "@alterx/shared-clients";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUDIT_QUERY_SERVICE_TOKEN_HASH, AuditQueryController } from "../../../audit-service/src/audit/audit-query.controller";
import { AuditService } from "../../../audit-service/src/audit/audit.service";
import { AuditEventsClient } from "../engine";
import type { EngineConfig } from "../engine/config";
import { RbacModule, type ActorContextType, type RbacRequest } from "../rbac";
import { AuditEventsController } from "./audit-events.controller";
import { AuditEventsExceptionFilter } from "./audit-events-exception.filter";
import { AuditEventsService } from "./audit-events.service";

const TOKEN = "platform-to-audit-test-token";
const tenantA = "ten_018f47a5-7b2c-7d10-8f11-123456789abc";
const tenantB = "ten_028f47a5-7b2c-7d10-8f11-123456789abc";
const actor: ActorContextType = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: tenantA,
  session_id: "session-a",
  roles: ["member"],
  permissions: [],
};

describe("audit-events platform relay", () => {
  let auditApp: NestFastifyApplication;
  let platformApp: NestFastifyApplication;

  beforeAll(async () => {
    const store = createMockAuditStoreProvider();
    const auditService = new AuditService(store);
    await seed(auditService, tenantA, "user", "tenant-a.user");
    await seed(auditService, tenantA, "support", "tenant-a.support", "case-1");
    await seed(auditService, tenantA, "admin", "tenant-a.admin");
    await seed(auditService, tenantA, "system", "tenant-a.system");
    await seed(auditService, tenantB, "user", "tenant-b.user");

    const auditModule = await Test.createTestingModule({
      controllers: [AuditQueryController],
      providers: [
        { provide: AuditService, useValue: auditService },
        { provide: AUDIT_STORE_PROVIDER, useValue: store },
        { provide: AUDIT_QUERY_SERVICE_TOKEN_HASH, useValue: createHash("sha256").update(TOKEN).digest("hex") },
      ],
    }).compile();
    auditApp = auditModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await auditApp.listen(0, "127.0.0.1");
    const address = auditApp.getHttpServer().address();
    if (!address || typeof address === "string") throw new Error("audit service did not bind TCP");

    const config: EngineConfig = {
      baseUrl: "http://engine.test", adsCoreBaseUrl: "http://ads.test", costLedgerBaseUrl: "http://costs.test",
      auditServiceBaseUrl: `http://127.0.0.1:${address.port}`,
      auditQueryServiceTokenRef: "test/audit-query-token",
      evalFacadeTokenRef: "env:EVAL_FACADE_TOKEN", m2mTokenUrl: "https://identity.test/token",
      m2mAudience: "engine", m2mClientId: "platform-api", m2mClientSecretRef: "env:ENGINE_SECRET", requestTimeoutMs: 100,
    };
    const secrets: SecretsProvider = { getSecret: async (reference) => {
      if (reference !== "test/audit-query-token") throw new Error("unexpected secret reference");
      return TOKEN;
    } } as SecretsProvider;
    const auditClient = new AuditEventsClient(config, secrets);
    const platformModule = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [AuditEventsController],
      providers: [
        AuditEventsService,
        AuditEventsExceptionFilter,
        { provide: AuditEventsClient, useValue: auditClient },
      ],
    }).compile();
    platformApp = platformModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    platformApp.getHttpAdapter().getInstance().addHook("preHandler", (request: FastifyRequest, _reply: unknown, done: () => void) => {
      const customer = request.headers["x-test-actor"];
      const staff = request.headers["x-test-staff"];
      if (typeof customer === "string") (request as RbacRequest).actorContext = JSON.parse(customer) as ActorContextType;
      if (typeof staff === "string") {
        (request as RbacRequest).staffActorContext = JSON.parse(staff) as NonNullable<RbacRequest["staffActorContext"]>;
      }
      done();
    });
    await platformApp.init();
    await platformApp.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await platformApp.close();
    await auditApp.close();
  });

  it("forces customer tenant and safe actor types despite cross-tenant/admin query input", async () => {
    const response = await platform("/api/v1/audit-events?tenant_id=" + tenantB + "&actor_types=admin,system&limit=200", { "x-test-actor": JSON.stringify(actor) });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { events: Array<{ action: string; actor_type: string }>; next_cursor: string | null };
    expect(body.events.map((event) => event.action).sort()).toEqual(["tenant-a.support", "tenant-a.user"]);
    expect(body.events.map((event) => event.actor_type).sort()).toEqual(["support", "user"]);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("allows staff-only cross-tenant reads and blocks non-staff", async () => {
    const allowed = await platform("/api/v1/admin/audit-events?limit=200", {
      "x-test-staff": JSON.stringify({ staff_user_id: "stf_1", identity_ref: "staff|1", email: "staff@example.test", roles: ["staff_support"] }),
    });
    expect(allowed.statusCode).toBe(200);
    const staffPage = allowed.json() as { events: Array<{ action: string }> };
    expect(staffPage.events).toHaveLength(5);
    expect(staffPage.events.map((event) => event.action)).toContain("tenant-b.user");

    const denied = await platform("/api/v1/admin/audit-events?limit=200", { "x-test-actor": JSON.stringify(actor) });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error_code: "RBAC_ROLE_DENIED" });
  });

  function platform(url: string, headers: Record<string, string>) {
    return platformApp.getHttpAdapter().getInstance().inject({ method: "GET", url, headers });
  }
});

async function seed(
  audit: AuditService,
  tenantId: string,
  actorType: "user" | "service" | "admin" | "support" | "system",
  action: string,
  reasonCode = "",
): Promise<void> {
  await audit.recordEvent({
    tenant_id: tenantId,
    actor_type: actorType,
    actor_ref: `${actorType}-1`,
    action,
    target_type: "",
    target_ref: "",
    result: "success",
    reason_code: reasonCode,
    context_json: "",
    occurred_at: "2026-08-05T00:00:00.000Z",
  });
}
