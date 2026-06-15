import { Suspense } from "react";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { Skeleton } from "@/shared/ui/skeleton";
import { watchlistKeys } from "../lib/query-keys";
import { Awaiting } from "./sections/awaiting";
import { ComingUp } from "./sections/coming-up";
import { MoodMosaic } from "./sections/mood-mosaic";
import { ReadyRow } from "./sections/ready-row";
import { RecentlyAdded } from "./sections/recently-added";
import { TonightPick } from "./sections/tonight-pick";
import { WatchlistErrorFallback } from "./watchlist-error-fallback";

// Approximate skeleton heights for each section type. These values match the
// typical rendered height when data is present; sections that resolve to null
// when empty will cause a layout shift from skeleton to nothing — a known
// trade-off until each section exposes its own typed skeleton component.
const SK_HERO = 420; // Tonight pick: 16/9 hero card + alternates list.
const SK_SCROLL_ROW = 360; // Poster scroll row (2/3 cards ≈ 300px + head).
const SK_MOOD_MOSAIC = 560; // 3-column mood cluster grid.
const SK_GRID_ROW = 300; // Single-row backdrop (16/9) grid.
const SK_GRID_TALL = 400; // Awaiting: multi-row poster grid.
const SK_LIST = 360; // Recently-added list rows.

/**
 * Curated content for `/watchlist`. Each section fetches its own data behind
 * its own Suspense boundary so a slow Tonight pick can't block the rest of
 * the page from painting. Header + peek modal live in the layout route.
 */
export function WatchlistCuratedPage() {
  return (
    <>
      <SectionFrame heightPx={SK_HERO} queryKey={watchlistKeys.tonight()}>
        <TonightPick />
      </SectionFrame>
      <SectionFrame heightPx={SK_SCROLL_ROW} queryKey={watchlistKeys.items({ bucket: "ready" })}>
        <ReadyRow />
      </SectionFrame>
      <SectionFrame heightPx={SK_MOOD_MOSAIC} queryKey={watchlistKeys.moods()}>
        <MoodMosaic />
      </SectionFrame>
      <SectionFrame heightPx={SK_GRID_ROW} queryKey={watchlistKeys.items({ bucket: "upcoming" })}>
        <ComingUp />
      </SectionFrame>
      <SectionFrame heightPx={SK_GRID_TALL} queryKey={watchlistKeys.items({ bucket: "awaiting" })}>
        <Awaiting />
      </SectionFrame>
      <SectionFrame heightPx={SK_LIST} queryKey={watchlistKeys.recently()}>
        <RecentlyAdded />
      </SectionFrame>
    </>
  );
}

interface SectionFrameProps {
  children: React.ReactNode;
  heightPx: number;
  /** Query key the section's retry button should reset. */
  queryKey: readonly unknown[];
}

function SectionFrame({ children, heightPx, queryKey }: SectionFrameProps) {
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <WatchlistErrorFallback error={error} resetErrorBoundary={reset} queryKey={queryKey} />
      )}
    >
      <Suspense
        fallback={<Skeleton className="mb-14 w-full rounded-2xl" style={{ height: heightPx }} />}
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
