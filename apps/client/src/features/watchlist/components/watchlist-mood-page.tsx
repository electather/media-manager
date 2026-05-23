import { Suspense, useCallback } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import type { MoodId } from "@ent-mcp/shared/watchlist";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { Skeleton } from "@/shared/ui/skeleton";
import { Button } from "@/shared/ui/button";
import { VirtualGrid } from "@/shared/components/virtualized";
import { WatchlistCard } from "./watchlist-card";
import { useMoodCluster } from "../hooks/use-mood-cluster";
import { watchlistKeys } from "../lib/query-keys";
import { WatchlistErrorFallback } from "./watchlist-error-fallback";

const MOOD_PAGE_LIMIT = 60;

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
      <Suspense fallback={<Skeleton className="h-150 w-full rounded-2xl" />}>
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
  return (
    <>
      <VirtualGrid
        items={items}
        getKey={(it) => it.id}
        minColumnWidthPx={180}
        estimateRowHeight={() => 336}
        renderItem={(it) => <WatchlistCard item={it} forceAspect="2/3" onPeek={onPeek} />}
      />
      {hasNextPage ? (
        <div className="mt-8 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? m.watchlist_loading_more() : m.watchlist_load_more()}
          </Button>
        </div>
      ) : null}
    </>
  );
}
