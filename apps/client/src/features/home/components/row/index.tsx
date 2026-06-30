import { memo, useMemo, useRef } from "react";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import {
  BACKDROP_VARS,
  POSTER_VARS,
  ScrollRow,
  ScrollRowNextButton,
  ScrollRowPrevButton,
  ScrollRowViewport,
} from "@/shared/components/scroll-row";
import { useMediaRowsLazy } from "@/shared/media/use-media-rows";
import { useRangePrefetch } from "../../hooks/use-range-prefetch";
import { homeRowSource } from "../../lib/sources";
import { resolveRowCopy } from "../../lib/row-copy";
import { rowStatus } from "../../lib/row-status";
import { buildTrackEntries } from "../../lib/track-entries";
import type { HomeMediaItem, RowAspect, RowData } from "../../lib/types";
import { RowError } from "./row-error";
import { RowItemTrack, RowSkeletonTrack } from "./row-track";

// Longer than the 60s default: home rows are server-warmed feeds that shift
// slowly, so a 5-min window matches the layout cache and avoids refetching
// every row when the feed is briefly remounted.
const ROW_STALE_MS = 5 * 60 * 1000;

interface RowProps {
  row: RowData;
  onWatchlistToggle?: (item: HomeMediaItem) => void;
  onCardClick?: (id: string) => void;
}

/**
 * Server-driven home-feed row. Composes the shared `ScrollRow` slots around
 * items read through `useMediaRowsLazy(homeRowSource)`. Branch selection
 * (`rowStatus`), copy resolution (`resolveRowCopy`), the trailing error card
 * (`buildTrackEntries`), and range prefetch (`useRangePrefetch`) are each
 * factored out; this body only orchestrates them.
 */
// fallow-ignore-next-line complexity
function RowImpl({ row, onWatchlistToggle, onCardClick }: RowProps) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const isBackdrop = row.defaultAspect === "16/9";
  const cardVars = isBackdrop ? BACKDROP_VARS : POSTER_VARS;
  const aspect: RowAspect = isBackdrop ? "16/9" : "2/3";

  const { heading, eyebrow, prevLabel, nextLabel } = resolveRowCopy(row);

  // Row stubs carry `sourceId` (= rowId) + `initialCursor`; each feeds a shared
  // `useMediaRowsLazy` source so the home feed reads through the one media list
  // hook core (design §B3 / invariant V.CL1). Per-row lazy reads keep a slow row
  // showing its own skeleton without blocking the rest of the feed.
  const source = useMemo(
    () => homeRowSource(row.id, row.initialCursor),
    [row.id, row.initialCursor],
  );
  const {
    items,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isFetchingNextPage,
    error,
    refetch,
    isRefetching,
  } = useMediaRowsLazy(source, { staleTime: ROW_STALE_MS });

  const status = rowStatus({ error, isLoading, itemCount: items.length });
  const showInlineError = error !== null && items.length > 0;
  const entries = useMemo(
    () => buildTrackEntries(items, showInlineError),
    [items, showInlineError],
  );

  const handleRange = useRangePrefetch({
    itemCount: items.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  });

  if (status === "initial-error" && error !== null) {
    return (
      <div
        ref={scopeRef}
        className="row-track-scope"
        data-testid="row-scroller-bleed"
        style={cardVars}
      >
        <RowError error={error} onRetry={() => refetch()} isRetrying={isRefetching} />
      </div>
    );
  }

  // A resolved-but-empty row renders nothing — no heading, no reserved track
  // height. Covers a soft-degraded source (empty `partial` page) and a
  // genuinely empty feed alike; an empty carousel communicates nothing useful.
  if (status === "empty") {
    return null;
  }

  return (
    <ScrollRow revalidationKey={entries.length} className="mb-8">
      <SectionHead>
        <SectionHeadHeading>
          {eyebrow ? <SectionHeadEyebrow>{eyebrow}</SectionHeadEyebrow> : null}
          <SectionHeadTitle>{heading}</SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <ScrollRowPrevButton aria-label={prevLabel} />
          <ScrollRowNextButton aria-label={nextLabel} />
        </SectionHeadActions>
      </SectionHead>
      <ScrollRowViewport data-testid="row-scroller-bleed" style={cardVars}>
        {status === "skeletons" ? (
          <RowSkeletonTrack heading={heading} aspect={aspect} />
        ) : (
          <RowItemTrack
            heading={heading}
            entries={entries}
            isBackdrop={isBackdrop}
            rowKind={row.kind}
            error={error}
            isFetchingNextPage={isFetchingNextPage}
            onRangeChange={handleRange}
            onRetryPage={() => fetchNextPage()}
            onWatchlistToggle={onWatchlistToggle}
            onCardClick={onCardClick}
          />
        )}
      </ScrollRowViewport>
    </ScrollRow>
  );
}

/**
 * Memoised so that re-renders of `HomeFeedReady` (driven by hero / search /
 * watchlist hooks) don't cascade into every visible row. Membership lookup
 * lives inside `<Card>` via `useIsInWatchlist`, so Row no longer needs the
 * full watchlist set on its prop surface.
 */
export const Row = memo(RowImpl);
