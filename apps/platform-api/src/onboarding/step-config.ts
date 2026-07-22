// Illustrative v1 order. UI/product must confirm keys before wizard launch.
export const onboardingStepKeys = [
  "choose_mode",
  "create_first_item",
  "invite_team",
  "connect_integration",
  "tour_complete",
] as const;

export type OnboardingStepKey = (typeof onboardingStepKeys)[number];
