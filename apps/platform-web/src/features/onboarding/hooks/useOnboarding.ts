import { create } from "zustand"

export interface OnboardingState {
  completed: boolean
  currentStep: number
  workspaceName?: string
  workspaceSlug?: string
  useCases: string[]
  setCompleted: (completed: boolean) => void
  setCurrentStep: (step: number) => void
  updateData: (data: Partial<OnboardingState>) => void
  reset: () => void
}

const initialState = {
  completed: localStorage.getItem("alterx_onboarding") === "completed",
  currentStep: 1,
  useCases: [],
}

export const useOnboarding = create<OnboardingState>((set) => ({
  ...initialState,
  setCompleted: (completed) => {
    if (completed) {
      localStorage.setItem("alterx_onboarding", "completed")
    } else {
      localStorage.removeItem("alterx_onboarding")
    }
    set({ completed })
  },
  setCurrentStep: (currentStep) => set({ currentStep }),
  updateData: (data) => set((state) => ({ ...state, ...data })),
  reset: () => {
    localStorage.removeItem("alterx_onboarding")
    set({ ...initialState, completed: false })
  },
}))
