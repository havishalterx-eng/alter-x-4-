import type { OnboardingStepKey } from "./step-config";

export type OnboardingStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "skipped";

export interface OnboardingStep {
  stepKey: OnboardingStepKey;
  status: "pending" | "completed";
  completedAt: string | null;
}

export interface OnboardingState {
  id: string;
  tenantId: string;
  workspaceId: string;
  steps: OnboardingStep[];
  currentStep: OnboardingStepKey | null;
  status: OnboardingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface OnboardingView extends OnboardingState {
  progress: {
    completed: number;
    total: number;
    percent: number;
  };
}

export type OnboardingAction =
  | { action: "complete"; stepKey: OnboardingStepKey }
  | { action: "skip" };
