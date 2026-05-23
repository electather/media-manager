import { Suspense } from "react";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { Skeleton } from "@/shared/ui/skeleton";
import { useCounts } from "../hooks/use-counts";
import { Awaiting } from "./sections/awaiting";
import { ComingUp } from "./sections/coming-up";
import { MoodMosaic } from "./sections/mood-mosaic";
import { ReadyRow } from "./sections/ready-row";
import { RecentlyAdded } from "./sections/recently-added";
import { TonightPick } from "./sections/tonight-pick";
import { WatchlistErrorFallback } from "./watchlist-error-fallback";
import { WatchlistHeader } from "./watchlist-header";
import { WatchlistPeekModal } from "./watchlist-peek-modal";

/**
 * Curated `/watchlist` page. Counts drive the header pips and resolve
 * inside the route loader; every section then fetches its own data inside
 * its own Suspense boundary so a slow Tonight pick can't block the rest of
 * the page from painting.
 */
export function WatchlistPage() {
  const { data: counts } = useCounts();
  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 sm:px-6 lg:px-8">
      <WatchlistHeader mode="curated" counts={counts} />
      <div className="pb-32">
        <SectionFrame heightPx={420}>
          <TonightPick />
        </SectionFrame>
        <SectionFrame heightPx={360}>
          <ReadyRow />
        </SectionFrame>
        <SectionFrame heightPx={560}>
          <MoodMosaic />
        </SectionFrame>
        <SectionFrame heightPx={300}>
          <ComingUp />
        </SectionFrame>
        <SectionFrame heightPx={400}>
          <Awaiting />
        </SectionFrame>
        <SectionFrame heightPx={360}>
          <RecentlyAdded />
        </SectionFrame>
      </div>
      <WatchlistPeekModal />
    </main>
  );
}

interface SectionFrameProps {
  children: React.ReactNode;
  heightPx: number;
}

/** Per-section Suspense + ErrorBoundary wrapper. */
function SectionFrame({ children, heightPx }: SectionFrameProps) {
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <WatchlistErrorFallback error={error} resetErrorBoundary={reset} />
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
