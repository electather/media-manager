import { Suspense } from "react";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { Skeleton } from "@/shared/ui/skeleton";
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
    </>
  );
}

interface SectionFrameProps {
  children: React.ReactNode;
  heightPx: number;
}

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
