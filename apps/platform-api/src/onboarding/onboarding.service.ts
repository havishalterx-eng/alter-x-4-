import type { ActorContext } from "../rbac/types";
import { OnboardingHttpError } from "./problem";
import { onboardingStepKeys, type OnboardingStepKey } from "./step-config";
import type { OnboardingRepository } from "./onboarding.repository";
import type {
  OnboardingAction,
  OnboardingState,
  OnboardingView,
} from "./types";

export class OnboardingService {
  constructor(
    private readonly repository: Pick<OnboardingRepository, "find" | "save">,
    private readonly now = () => new Date(),
  ) {}

  async get(actor: ActorContext, workspaceId?: string): Promise<OnboardingView> {
    const targetWorkspace = requireWorkspace(actor, workspaceId);
    const state = await this.repository.find(actor.tenant_id, targetWorkspace);
    if (!state) {
      throw new OnboardingHttpError(
        404,
        "ONBOARDING_NOT_FOUND",
        "Onboarding state not found",
      );
    }
    return view(state);
  }

  async update(
    actor: ActorContext,
    workspaceId: string | undefined,
    action: OnboardingAction,
    ifMatch: string | undefined,
  ): Promise<OnboardingView> {
    const current = await this.get(actor, workspaceId);
    if (!ifMatch) {
      throw new OnboardingHttpError(
        428,
        "IF_MATCH_REQUIRED",
        "If-Match header required",
      );
    }
    if (ifMatch !== onboardingEtag(current)) {
      throw new OnboardingHttpError(412, "ETAG_MISMATCH", "Onboarding state changed");
    }

    const next = action.action === "skip" ? skip(current) : complete(current, action.stepKey, this.now());
    if (next === current) return current;

    const saved = await this.repository.save(next, current.updatedAt);
    if (!saved) {
      throw new OnboardingHttpError(412, "ETAG_MISMATCH", "Onboarding state changed");
    }
    return view(saved);
  }
}

export function onboardingEtag(state: OnboardingState): string {
  return `"${new Date(state.updatedAt).toISOString()}"`;
}

function complete(
  state: OnboardingState,
  stepKey: OnboardingStepKey,
  completedAt: Date,
): OnboardingState {
  const step = state.steps.find((candidate) => candidate.stepKey === stepKey);
  if (!step || !onboardingStepKeys.includes(stepKey)) {
    throw new OnboardingHttpError(400, "INVALID_ONBOARDING_STEP", "Unknown step");
  }
  if (step.status === "completed") return state;
  if (state.currentStep !== stepKey) {
    throw new OnboardingHttpError(
      409,
      "ONBOARDING_STEP_OUT_OF_ORDER",
      "Complete current step before advancing",
    );
  }

  const steps = state.steps.map((candidate) =>
    candidate.stepKey === stepKey
      ? { ...candidate, status: "completed" as const, completedAt: completedAt.toISOString() }
      : candidate,
  );
  const currentStep = steps.find((candidate) => candidate.status === "pending")?.stepKey ?? null;
  return {
    ...state,
    steps,
    currentStep,
    status: currentStep ? "in_progress" : "completed",
  };
}

function skip(state: OnboardingState): OnboardingState {
  if (state.status !== "in_progress") {
    throw new OnboardingHttpError(
      409,
      "ONBOARDING_SKIP_NOT_ALLOWED",
      "Wizard can be skipped only after onboarding starts",
    );
  }
  return { ...state, status: "skipped", currentStep: null };
}

function requireWorkspace(actor: ActorContext, requested?: string): string {
  if (!actor.workspace_id) {
    throw new OnboardingHttpError(
      403,
      "ONBOARDING_WORKSPACE_REQUIRED",
      "Workspace actor context required",
    );
  }
  if (requested && requested !== actor.workspace_id) {
    throw new OnboardingHttpError(
      403,
      "ONBOARDING_WORKSPACE_MISMATCH",
      "Cross-workspace onboarding access denied",
    );
  }
  return actor.workspace_id;
}

function view(state: OnboardingState): OnboardingView {
  const completed = state.steps.filter((step) => step.status === "completed").length;
  const total = state.steps.length;
  return {
    ...state,
    progress: {
      completed,
      total,
      percent: total === 0 ? 100 : Math.round((completed / total) * 100),
    },
  };
}
