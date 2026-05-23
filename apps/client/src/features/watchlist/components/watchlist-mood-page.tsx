import { Suspense, useCallback } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import type { MoodId } from "@ent-mcp/shared/watchlist";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { Skeleton } from "@/shared/ui/skeleton";
import { Button } from "@/shared/ui/button";
import { VirtualGrid } from "@/shared/components/virtualized";
import {
  SectionHead,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { WatchlistCard } from "./watchlist-card";
import { useCounts } from "../hooks/use-counts";
import { useMoodCluster } from "../hooks/use-mood-cluster";
import { useMoods } from "../hooks/use-moods";
import { MOOD_REGISTRY } from "../lib/mood-registry";
import { WatchlistErrorFallback } from "./watchlist-error-fallback";
import { WatchlistHeader } from "./watchlist-header";
import { WatchlistPeekModal } from "./watchlist-peek-modal";

const MOOD_PAGE_LIMIT = 60;

/**
 * `/watchlist/moods/:moodId` view. Reads `moodId` from the path, fetches
 * the cluster summary for the header count, and paginates through the
 * cluster items in a virtualized grid. Unknown `moodId` lands on the
 * 400 path → the surrounding ErrorBoundary renders the fallback.
 */
export function WatchlistMoodPage() {
  const { moodId } = useParams({ strict: false }) as { moodId: MoodId };
  const { data: counts } = useCounts();
  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 sm:px-6 lg:px-8">
      <WatchlistHeader mode="curated" counts={counts} />
      <div className="pb-32">
        <ErrorBoundary
          fallback={({ error, reset }) => (
            <WatchlistErrorFallback error={error} resetErrorBoundary={reset} />
          )}
        >
          <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-2xl" />}>
            <MoodGrid moodId={moodId} />
          </Suspense>
        </ErrorBoundary>
      </div>
      <WatchlistPeekModal />
    </main>
  );
}

function MoodGrid({ moodId }: { moodId: MoodId }) {
  const { data: summary } = useMoods();
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
  const cluster = summary.clusters.find((c) => c.moodId === moodId);
  const count = cluster?.count ?? items.length;
  const copy = MOOD_REGISTRY[moodId];
  return (
    <>
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>
            {m.watchlist_mood_page_eyebrow({ count: String(count) })}
          </SectionHeadEyebrow>
          <SectionHeadTitle>{m.watchlist_mood_page_title({ mood: copy.label() })}</SectionHeadTitle>
        </SectionHeadHeading>
      </SectionHead>
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
