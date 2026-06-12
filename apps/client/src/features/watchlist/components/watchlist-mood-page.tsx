import { Suspense, useCallback } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { MoodId } from "@ent-mcp/shared/watchlist";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { GridSkeleton } from "@/shared/components/grid-skeleton";
import { VirtualGrid } from "@/shared/components/virtualized";
import { WatchlistCard } from "./watchlist-card";
import { useMoodCluster } from "../hooks/use-mood-cluster";
import { watchlistKeys } from "../lib/query-keys";
import { WatchlistErrorFallback } from "./watchlist-error-fallback";

/** Page size for the dedicated mood route — shared with its loader prefetch so
 *  both build the same `watchlist-mood-items` cache key (#513). */
export const MOOD_PAGE_LIMIT = 60;

/**
 * `/watchlist/moods/:moodId` content. Header + peek modal live in the
 * layout route; this page renders the cluster grid + its Suspense
 * boundary. Unknown `moodId` lands on the 400 path → the surrounding
 * ErrorBoundary renders the fallback.
 */
export function WatchlistMoodPage() {
  const { moodId } = useParams({ strict: false }) as { moodId: MoodId };
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <WatchlistErrorFallback
          error={error}
          resetErrorBoundary={reset}
          queryKey={watchlistKeys.moodItems(moodId)}
        />
      )}
    >
      <Suspense fallback={<GridSkeleton />}>
        <MoodGrid moodId={moodId} />
      </Suspense>
    </ErrorBoundary>
  );
}

function MoodGrid({ moodId }: { moodId: MoodId }) {
  const { items, hasNextPage, isFetchingNextPage, fetchNextPage } = useMoodCluster(
    moodId,
    MOOD_PAGE_LIMIT,
  );
  const navigate = useNavigate();
  const onPeek = useCallback(
    (id: string) => {
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, peek: id }),
        replace: false,
        resetScroll: false,
      });
    },
    [navigate],
  );
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return (
    <VirtualGrid
      items={items}
      getKey={(it) => it.id}
      minColumnWidthPx={180}
      estimateRowHeight={() => 336}
      renderItem={(it) => <WatchlistCard item={it} forceAspect="2/3" onPeek={onPeek} />}
      onEndReached={onEndReached}
    />
  );
}
