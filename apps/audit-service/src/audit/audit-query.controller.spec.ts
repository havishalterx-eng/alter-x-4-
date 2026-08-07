import { createHash } from "node:crypto";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ProblemDetailsSchema } from "@alterx/contracts";
import { AuditValidationError } from "@alterx/shared-clients";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUDIT_QUERY_SERVICE_TOKEN_HASH,
  AuditQueryController,
} from "./audit-query.controller";
import { AuditService } from "./audit.service";

const TOKEN = "audit-internal-query-token";
const queryEvents = vi.fn();
const recordEvent = vi.fn();

describe("AuditQueryController RFC 9457 internal surface", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuditQueryController],
      providers: [
        { provide: AuditService, useValue: { queryEvents, recordEvent } },
        {
          provide: AUDIT_QUERY_SERVICE_TOKEN_HASH,
          useValue: createHash("sha256").update(TOKEN).digest("hex"),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    queryEvents.mockReset();
    recordEvent.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects missing credentials with a sanitized problem response", async () => {
    const response = await request("/internal/audit-events?tenant_id=ten_sensitive-tenant");
    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    const problem = ProblemDetailsSchema.parse(response.json());
    expect(problem).toMatchObject({ status: 401, error_code: "AUDIT_QUERY_AUTHENTICATION_FAILED" });
    expect(JSON.stringify(problem)).not.toContain("sensitive-tenant");
    expect(queryEvents).not.toHaveBeenCalled();
  });

  it("returns an authenticated successful query", async () => {
    queryEvents.mockResolvedValue({ events: [], next_cursor: null });
    const response = await request(
      "/internal/audit-events?tenant_id=ten_018f47a2-7b11-7b11-8a11-1234567890ab",
      `Bearer ${TOKEN}`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ events: [], next_cursor: null });
    expect(queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "ten_018f47a2-7b11-7b11-8a11-1234567890ab" }),
    );
  });

  it("records an authenticated audit event", async () => {
    recordEvent.mockResolvedValue({ id: "aud_event", entry_hash: "ab".repeat(32) });
    const body = {
      tenant_id: "f0204070-2fd2-4bb7-a117-3222301822fe",
      actor_type: "admin",
      actor_ref: "stf_ops",
      action: "tenant.suspend",
      target_type: "tenant",
      target_ref: "f0204070-2fd2-4bb7-a117-3222301822fe",
      result: "success",
      reason_code: "policy_violation",
      context_json: JSON.stringify({ scope: "tenant:write" }),
      occurred_at: "2026-08-06T10:00:00.000Z",
    };
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/internal/audit-events",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    expect(recordEvent).toHaveBeenCalledWith(body);
  });

  it("rejects unauthenticated audit writes", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/internal/audit-events",
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("applies the default limit when none is supplied and clamps an oversized limit", async () => {
    queryEvents.mockResolvedValue({ events: [], next_cursor: null });
    await request("/internal/audit-events", `Bearer ${TOKEN}`);
    expect(queryEvents).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));

    queryEvents.mockClear();
    await request("/internal/audit-events?limit=5000", `Bearer ${TOKEN}`);
    expect(queryEvents).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  });

  it("rejects a non-integer limit", async () => {
    const response = await request("/internal/audit-events?limit=not-a-number", `Bearer ${TOKEN}`);
    expect(response.statusCode).toBe(400);
    expect(queryEvents).not.toHaveBeenCalled();
  });

  it("maps AuditValidationError to a 400 problem without leaking internals", async () => {
    queryEvents.mockRejectedValue(new AuditValidationError("actor_types contains an unsupported value"));
    const response = await request("/internal/audit-events", `Bearer ${TOKEN}`);
    const problem = ProblemDetailsSchema.parse(response.json());
    expect(problem).toMatchObject({ status: 400, error_code: "AUDIT_QUERY_VALIDATION_FAILED" });
  });

  it("sanitizes an unexpected failure", async () => {
    queryEvents.mockRejectedValue(new Error("database error containing connection-string-secret"));
    const response = await request("/internal/audit-events", `Bearer ${TOKEN}`);
    const problem = ProblemDetailsSchema.parse(response.json());
    expect(problem).toMatchObject({ status: 500, error_code: "AUDIT_QUERY_INTERNAL_ERROR" });
    expect(JSON.stringify(problem)).not.toContain("connection-string-secret");
  });

  function request(url: string, authorization?: string) {
    return app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url,
      headers: authorization === undefined ? {} : { authorization },
    });
  }
});
