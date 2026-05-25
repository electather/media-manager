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

/**
 * Curated content for `/watchlist`. Each section fetches its own data behind
 * its own Suspense boundary so a slow Tonight pick can't block the rest of
 * the page from painting. Header + peek modal live in the layout route.
 */
export function WatchlistCuratedPage() {
  return (
    <>
      <SectionFrame heightPx={420} queryKey={watchlistKeys.tonight()}>
        <TonightPick />
      </SectionFrame>
      <SectionFrame heightPx={360} queryKey={watchlistKeys.items({ bucket: "ready" })}>
        <ReadyRow />
      </SectionFrame>
      <SectionFrame heightPx={560} queryKey={watchlistKeys.moods()}>
        <MoodMosaic />
      </SectionFrame>
      <SectionFrame heightPx={300} queryKey={watchlistKeys.items({ bucket: "upcoming" })}>
        <ComingUp />
      </SectionFrame>
      <SectionFrame heightPx={400} queryKey={watchlistKeys.items({ bucket: "awaiting" })}>
        <Awaiting />
      </SectionFrame>
      <SectionFrame heightPx={360} queryKey={watchlistKeys.recently()}>
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
