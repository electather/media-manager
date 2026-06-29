import { createFileRoute } from "@tanstack/react-router";
import {
  OnboardingErrorBoundary,
  OnboardingErrorFallback,
  OnboardingSkeleton,
  OnboardingWizard,
  onboardingStateQueryOptions,
} from "@/features/onboarding";

export const Route = createFileRoute("/_authenticated/setup")({
  // Warm the wizard's suspense read in the loader so the pending UI shows the
  // onboarding skeleton; the boundary below catches render-time refetch errors.
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(onboardingStateQueryOptions()),
  pendingComponent: OnboardingSkeleton,
  errorComponent: OnboardingErrorFallback,
  component: () => (
    <OnboardingErrorBoundary>
      <OnboardingWizard />
    </OnboardingErrorBoundary>
  ),
});
