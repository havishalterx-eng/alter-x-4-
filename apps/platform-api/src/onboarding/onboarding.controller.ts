import { Body, Controller, Get, Headers, Patch, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ActorContext, RequireWorkspaceRole } from "../rbac/decorators";
import type { ActorContext as Actor } from "../rbac/types";
import { OnboardingHttpError } from "./problem";
import { OnboardingService, onboardingEtag } from "./onboarding.service";
import type { OnboardingAction } from "./types";
import { onboardingStepKeys } from "./step-config";

@Controller("/api/v1/onboarding")
@RequireWorkspaceRole("admin", "editor", "operator", "approver", "viewer")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  async get(
    @ActorContext() actor: Actor | undefined,
    @Query("workspaceId") workspaceId: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const state = await this.onboarding.get(requireActor(actor), workspaceId);
    reply.header("ETag", onboardingEtag(state)).send(state);
  }

  @Patch()
  async update(
    @ActorContext() actor: Actor | undefined,
    @Query("workspaceId") workspaceId: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: { action?: unknown; stepKey?: unknown },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const state = await this.onboarding.update(
      requireActor(actor),
      workspaceId,
      parseAction(body),
      ifMatch,
    );
    reply.header("ETag", onboardingEtag(state)).send(state);
  }
}

function parseAction(body: {
  action?: unknown;
  stepKey?: unknown;
}): OnboardingAction {
  if (body.action === "skip") return { action: "skip" };
  if (
    body.action === "complete" &&
    typeof body.stepKey === "string" &&
    onboardingStepKeys.includes(body.stepKey as (typeof onboardingStepKeys)[number])
  ) {
    return {
      action: "complete",
      stepKey: body.stepKey as (typeof onboardingStepKeys)[number],
    };
  }
  throw new OnboardingHttpError(
    400,
    "INVALID_ONBOARDING_ACTION",
    "Use complete with a valid stepKey, or skip",
  );
}

function requireActor(actor: Actor | undefined): Actor {
  if (!actor) {
    throw new OnboardingHttpError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authenticated actor required",
    );
  }
  return actor;
}
