import { APP_FILTER } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyRequest } from "fastify";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  EngineClient,
  EngineExceptionFilter,
  EngineProblemError,
  type EngineCallerContext,
  type EnginePath,
  type EngineResponse,
} from "../engine";
import { RbacModule, type ActorContextType, type RbacRequest } from "../rbac";
import { EventController } from "./event.controller";
import { EventExceptionFilter } from "./event-exception.filter";
import { EventService } from "./event.service";
import type { EnginePage, EngineResource } from "./types";

const eventId = "evt_018f47a5-7b2c-7d10-8f11-123456789abc";
const actor: ActorContextType = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session-a",
  auth_time: 1_700_000_000,
  roles: ["viewer"],
  permissions: ["runs:read"],
};
const noScope: ActorContextType = { ...actor, permissions: [] };

describe("EventController routes", () => {
  let app: NestFastifyApplication;
  const engine = new EventEngine();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [EventController],
      providers: [
        EventService,
        EventExceptionFilter,
        { provide: EngineClient, useValue: engine },
        { provide: APP_FILTER, useClass: EngineExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.getHttpAdapter().getInstance().addHook(
      "preHandler",
      (request: FastifyRequest, _reply: unknown, done: () => void) => {
        const value = request.headers["x-test-actor"];
        if (typeof value === "string") {
          (request as RbacRequest).actorContext = JSON.parse(
            value,
          ) as ActorContextType;
        }
        done();
      },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => engine.reset());

  afterAll(async () => app.close());

  it("lists real events with only real filters", async () => {
    const response = await request("/api/v1/events?source=whatsapp&status=triggered", actor);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(engine.eventList);
    expect(engine.get).toHaveBeenCalledWith(
      "/api/v1/events?source=whatsapp&status=triggered",
      expect.objectContaining({ tenantId: actor.tenant_id, permissions: ["runs:read"] }),
    );
  });

  it("relays a single event unchanged", async () => {
    const response = await request(`/api/v1/events/${eventId}`, actor);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(engine.event);
  });

  it("scope-gates both routes", async () => {
    for (const url of ["/api/v1/events", `/api/v1/events/${eventId}`]) {
      const response = await request(url, noScope);
      expectProblem(response, 403, "RBAC_PERMISSION_DENIED");
    }
    expect(engine.get).not.toHaveBeenCalled();
  });

  it("rejects a non-derivable status filter and a malformed event id", async () => {
    const badStatus = await request("/api/v1/events?status=matched", actor);
    expectProblem(badStatus, 400, "INVALID_EVENT_REQUEST");

    const badId = await request("/api/v1/events/bad", actor);
    expectProblem(badId, 400, "INVALID_EVENT_REQUEST");
  });

  it("passes through Engine problems for both routes", async () => {
    engine.failNext("/api/v1/events");
    const list = await request("/api/v1/events", actor);
    expectProblem(list, 503, "ENGINE_EVENT_UNAVAILABLE");

    engine.failNext(`/api/v1/events/${eventId}`);
    const detail = await request(`/api/v1/events/${eventId}`, actor);
    expectProblem(detail, 503, "ENGINE_EVENT_UNAVAILABLE");
  });

  function request(url: string, requestActor?: ActorContextType): Promise<TestResponse> {
    return app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url,
      headers: requestActor ? { "x-test-actor": JSON.stringify(requestActor) } : {},
    }) as Promise<TestResponse>;
  }
});

interface TestResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  json(): unknown;
}

class EventEngine {
  readonly get = vi.fn(this.getResponse.bind(this));
  readonly eventList = page([
    { event_id: eventId, source: "whatsapp", signature_status: "verified" },
  ]);
  readonly event = { event_id: eventId, source: "whatsapp", signature_status: "verified" };
  private failurePath: string | undefined;

  reset(): void {
    this.failurePath = undefined;
    this.get.mockClear();
  }

  failNext(path: string): void {
    this.failurePath = path;
  }

  private async getResponse(
    path: EnginePath,
    _context: EngineCallerContext,
  ): Promise<EngineResponse<EngineResource | EnginePage<EngineResource>>> {
    void _context;
    const barePath = path.split("?")[0]!;
    if (this.failurePath === barePath) {
      this.failurePath = undefined;
      throw new EngineProblemError({
        type: "https://errors.alter.ai/engine-event-unavailable",
        title: "ENGINE_EVENT_UNAVAILABLE",
        status: 503,
        detail: "Engine event service unavailable",
        instance: barePath,
        error_code: "ENGINE_EVENT_UNAVAILABLE",
        trace_id: "trc_engine",
        request_id: "req_engine",
        retryable: true,
        field_errors: [],
        documentation_key: "engine.event.unavailable",
      });
    }
    if (path.startsWith("/api/v1/events?") || path === "/api/v1/events") {
      return { status: 200, body: this.eventList };
    }
    if (path === `/api/v1/events/${eventId}`) {
      return { status: 200, body: this.event };
    }
    throw new Error(`Unexpected path ${path}`);
  }
}

function page(data: readonly EngineResource[]): EnginePage<EngineResource> {
  return {
    data,
    page: { next_cursor: null, has_more: false, limit: 50 },
  };
}

function expectProblem(response: TestResponse, status: number, errorCode: string): void {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toMatchObject({
    status,
    error_code: errorCode,
    field_errors: expect.any(Array),
  });
}
