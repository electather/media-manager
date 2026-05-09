import { createFileRoute } from "@tanstack/react-router";
import {
  HomeErrorBoundary,
  HomeErrorFallback,
  HomeFeed,
  HomeFeedSkeleton,
  homeLayoutQueryOptions,
} from "@/features/home";
import { peekSchema } from "@/lib/home-display";

export const Route = createFileRoute("/_authenticated/_app/")({
  validateSearch: peekSchema,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(homeLayoutQueryOptions()),
  pendingComponent: HomeFeedSkeleton,
  errorComponent: HomeErrorFallback,
  component: () => (
    <HomeErrorBoundary>
      <HomeFeed />
    </HomeErrorBoundary>
  ),
});
