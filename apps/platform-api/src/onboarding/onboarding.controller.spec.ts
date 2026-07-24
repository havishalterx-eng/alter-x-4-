import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, RbacRequest } from "../rbac/types";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingExceptionFilter } from "./onboarding-exception.filter";
import type { OnboardingRepository } from "./onboarding.repository";
import { OnboardingService, onboardingEtag } from "./onboarding.service";
import { onboardingStepKeys } from "./step-config";
import type { OnboardingState } from "./types";

const actor: ActorContext = {
  user_id: "user",
  tenant_id: "tenant-a",
  workspace_id: "workspace-a",
  roles: ["viewer"],
  permissions: [],
  session_id: "session",
};

function initialState(): OnboardingState {
  return {
    id: "state",
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    steps: onboardingStepKeys.map((stepKey) => ({
      stepKey,
      status: "pending",
      completedAt: null,
    })),
    currentStep: onboardingStepKeys[0],
    status: "not_started",
    createdAt: new Date("2026-07-22T00:00:00.000Z"),
    updatedAt: new Date("2026-07-22T00:00:00.000Z"),
  };
}

class MemoryRepository {
  state: OnboardingState | null = initialState();

  async find(tenantId: string, workspaceId: string) {
    return this.state?.tenantId === tenantId && this.state.workspaceId === workspaceId
      ? structuredClone(this.state)
      : null;
  }

  async save(state: OnboardingState, expectedUpdatedAt: Date) {
    if (
      !this.state ||
      this.state.updatedAt.getTime() !== expectedUpdatedAt.getTime()
    ) {
      return null;
    }
    this.state = {
      ...structuredClone(state),
      updatedAt: new Date(this.state.updatedAt.getTime() + 1_000),
    };
    return structuredClone(this.state);
  }
}

describe("OnboardingController HTTP errors", () => {
  let app: NestFastifyApplication;
  let repository: MemoryRepository;

  beforeEach(async () => {
    repository = new MemoryRepository();
    const moduleRef = await Test.createTestingModule({
      controllers: [OnboardingController],
      providers: [
        {
          provide: OnboardingService,
          useFactory: () =>
            new OnboardingService(
              repository as Pick<OnboardingRepository, "find" | "save">,
            ),
        },
        {
          provide: APP_FILTER,
          useClass: OnboardingExceptionFilter,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.getHttpAdapter().getInstance().addHook("preHandler", (request, _reply, done) => {
      const header = request.headers["x-test-actor"];
      if (typeof header === "string") {
        (request as RbacRequest).actorContext = JSON.parse(header) as ActorContext;
      }
      done();
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns application/problem+json for GET without workspace context", async () => {
    const { workspace_id: _workspaceId, ...actorWithoutWorkspace } = actor;
    void _workspaceId;

    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/v1/onboarding",
      headers: { "x-test-actor": JSON.stringify(actorWithoutWorkspace) },
    });

    expectProblem(
      response,
      403,
      "ONBOARDING_WORKSPACE_REQUIRED",
      "Workspace actor context required",
    );
  });

  it("returns application/problem+json for out-of-order PATCH transition", async () => {
    const current = initialState();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: "/api/v1/onboarding",
      headers: {
        "if-match": onboardingEtag(current),
        "x-test-actor": JSON.stringify(actor),
      },
      payload: { action: "complete", stepKey: "invite_team" },
    });

    expectProblem(
      response,
      409,
      "ONBOARDING_STEP_OUT_OF_ORDER",
      "Complete current step before advancing",
    );
  });

  it("returns application/problem+json for stale If-Match", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: "/api/v1/onboarding",
      headers: {
        "if-match": '"stale"',
        "x-test-actor": JSON.stringify(actor),
      },
      payload: { action: "complete", stepKey: "choose_mode" },
    });

    expectProblem(response, 412, "ETAG_MISMATCH", "Onboarding state changed");
  });
});

function expectProblem(
  response: { statusCode: number; headers: Record<string, unknown>; json: () => unknown },
  status: number,
  errorCode: string,
  detail: string,
): void {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toEqual(
    expect.stringContaining("application/problem+json"),
  );
  expect(response.json()).toEqual({
    type: `https://errors.alter.ai/${errorCode.toLowerCase()}`,
    title: errorCode,
    status,
    detail,
    instance: "/api/v1/onboarding",
    error_code: errorCode,
    trace_id: "trace-unavailable",
    request_id: "request-unavailable",
    retryable: false,
    field_errors: [],
    documentation_key: errorCode,
  });
}
