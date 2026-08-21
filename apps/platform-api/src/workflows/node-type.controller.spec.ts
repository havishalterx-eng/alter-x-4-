import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineClient, EngineExceptionFilter, type EngineResponse } from "../engine";
import { RbacModule, type ActorContextType, type RbacRequest } from "../rbac";
import { NodeTypeController } from "./node-type.controller";
import { WorkflowExceptionFilter } from "./workflow-exception.filter";
import { WorkflowService } from "./workflow.service";

const tenantId = "ten_018f47a5-7b2c-7d10-8f11-123456789abc";
const workspaceId = "ws_018f47a5-7b2c-7d10-8f11-123456789abc";
const viewer: ActorContextType = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: tenantId,
  workspace_id: workspaceId,
  session_id: "session-a",
  auth_time: 1_700_000_000,
  roles: ["viewer"],
  permissions: ["workflows:read"],
};

const nodeTypes = [
  { type: "LLMTask", display_name: "LLM Task", description: "d", category: "execution", config_schema_json: "{}", handler_implemented: true },
];

describe("NodeTypeController routes", () => {
  let app: NestFastifyApplication;
  const engineGet = vi.fn<EngineClient["get"]>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule],
      controllers: [NodeTypeController],
      providers: [
        WorkflowService,
        WorkflowExceptionFilter,
        { provide: EngineClient, useValue: { get: engineGet } },
        { provide: APP_FILTER, useClass: EngineExceptionFilter },
      ],
    }).compile();

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

  beforeEach(() => {
    engineGet.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the node type catalog for an authenticated workspace viewer", async () => {
    engineGet.mockResolvedValue({
      status: 200,
      body: { node_types: nodeTypes },
    } satisfies EngineResponse<{ node_types: typeof nodeTypes }>);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/node-types",
      headers: { "x-test-actor": JSON.stringify(viewer) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ node_types: nodeTypes });
    expect(engineGet).toHaveBeenCalledWith(
      "/api/v1/node-types",
      expect.objectContaining({ tenantId, workspaceId }),
    );
  });

  it("denies an unauthenticated request", async () => {
    // RbacGuard runs before the controller body and denies a missing
    // actor context with RBAC_ROLE_DENIED -- the controller's own
    // requireActor() 401 check is a defense-in-depth fallback for direct
    // (non-HTTP) calls, never reached on this path.
    const response = await app.inject({ method: "GET", url: "/api/v1/node-types" });
    expect(response.statusCode).toBe(403);
    expect(engineGet).not.toHaveBeenCalled();
  });
});
