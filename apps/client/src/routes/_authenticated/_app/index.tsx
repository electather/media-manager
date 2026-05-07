import { createFileRoute } from "@tanstack/react-router";
import {
  HomeErrorBoundary,
  HomeFeed,
  HomeFeedSkeleton,
  homeLayoutQueryOptions,
} from "@/features/home";
import { peekSchema } from "@/lib/home-display";

export const Route = createFileRoute("/_authenticated/_app/")({
  validateSearch: peekSchema,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(homeLayoutQueryOptions()),
  pendingComponent: HomeFeedSkeleton,
  errorComponent: ({ error }) => (
    <HomeErrorBoundary>
      <div className="p-6">{error.message}</div>
    </HomeErrorBoundary>
  ),
  component: () => (
    <HomeErrorBoundary>
      <HomeFeed />
    </HomeErrorBoundary>
  ),
});
