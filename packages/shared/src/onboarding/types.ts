/** One step as resolved by the server for `GET /api/onboarding/state`. */
export interface OnboardingStepState {
  id: string;
  title: string;
  applies: boolean;
  required: boolean;
  complete: boolean;
}

/** Response of `GET /api/onboarding/state`. */
export interface OnboardingState {
  hasOnboarded: boolean;
  steps: OnboardingStepState[];
}
