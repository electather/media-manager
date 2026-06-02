import { memo, useCallback, useMemo, useRef } from "react";
import * as m from "@/paraglide/messages";
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
  ScrollRowSkeleton,
  ScrollRowTrack,
  ScrollRowViewport,
} from "@/shared/components/scroll-row";
import { useMediaRowsLazy } from "@/shared/media/use-media-rows";
import { Card } from "../card/index";
import { homeRowSource } from "../../lib/sources";
import { ROW_COPY } from "../../lib/home-feed-config";
import type { HomeMediaItem, MessageKey, RowData } from "../../lib/types";
import { RowError, RowErrorInlineCard } from "./row-error";

const SKELETON_COUNT = 5;
const PREFETCH_OFFSET = 4;
const ROW_STALE_MS = 5 * 60 * 1000;

interface RowProps {
  row: RowData;
  onWatchlistToggle?: (item: HomeMediaItem) => void;
  onCardClick?: (id: string) => void;
}

const ERROR_SENTINEL = { __kind: "error-sentinel" as const };
type ErrorSentinel = typeof ERROR_SENTINEL;
type TrackEntry = HomeMediaItem | ErrorSentinel;

function isErrorSentinel(entry: TrackEntry): entry is ErrorSentinel {
  return (entry as ErrorSentinel).__kind === "error-sentinel";
}

/**
 * Server-driven home-feed row. Composes the shared `ScrollRow` slots
 * around items read through the shared `useMediaRowsLazy(homeRowSource)`.
 * Range-based prefetch + error / skeleton states are owned here; layout
 * primitives live in `shared/components/scroll-row`.
 */
// fallow-ignore-next-line complexity
function RowImpl({ row, onWatchlistToggle, onCardClick }: RowProps) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const isBackdrop = row.defaultAspect === "16/9";
  const cardVars = isBackdrop ? BACKDROP_VARS : POSTER_VARS;
  const aspect: "16/9" | "2/3" = isBackdrop ? "16/9" : "2/3";

  const copy = ROW_COPY[row.kind];
  const headerKey: MessageKey = row.headerKey ?? copy.headerKey;
  const headerFn = m[headerKey] as (params?: Record<string, string>) => string;
  if (import.meta.env.DEV && typeof headerFn !== "function") {
    throw new Error(`Row: unknown i18n key "${String(headerKey)}"`);
  }
  const heading = headerFn(row.seedTitle ? { seedTitle: row.seedTitle } : {});
  const eyebrowKey: MessageKey | undefined = row.eyebrowKey ?? copy.eyebrowKey;
  const eyebrowFn = eyebrowKey ? (m[eyebrowKey] as () => string) : null;
  const eyebrow = eyebrowFn ? eyebrowFn() : undefined;
  const prevLabel = m.home_row_prev_label({ row: heading });
  const nextLabel = m.home_row_next_label({ row: heading });

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

  const showInitialError = error !== null && items.length === 0;
  const showInlineError = error !== null && items.length > 0;
  const showSkeletons = !showInitialError && isLoading && items.length === 0;

  const renderItems = useMemo<TrackEntry[]>(
    () => (showInlineError ? [...items, ERROR_SENTINEL] : [...items]),
    [items, showInlineError],
  );

  const handleRange = useCallback(
    // fallow-ignore-next-line complexity
    ({ endIndex }: { startIndex: number; endIndex: number }) => {
      if (items.length === 0) return;
      if (!hasNextPage || isFetchingNextPage) return;
      if (endIndex >= items.length - PREFETCH_OFFSET) void fetchNextPage();
    },
    [items.length, hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  if (showInitialError) {
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

  // A row that resolved with no items renders nothing — no heading, no
  // reserved track height. Covers both a transient source outage (the feed
  // soft-degrades to an empty `partial` page rather than erroring) and a
  // genuinely empty feed; an empty carousel communicates nothing useful
  // either way. Guarded on `!isLoading` so the skeleton still shows on first
  // load. `handleRange` already bails on an empty set, so there is no pending
  // page to wait for here.
  if (error === null && !isLoading && items.length === 0) {
    return null;
  }

  return (
    <ScrollRow revalidationKey={renderItems.length} className="mb-8">
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
        {showSkeletons ? (
          <ScrollRowTrack aria-label={heading} className="scroll-px-8 pb-3">
            {Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <ScrollRowSkeleton key={`skeleton-${i}`} aspect={aspect} />
            ))}
          </ScrollRowTrack>
        ) : (
          <ScrollRowTrack
            virtualize
            aria-label={heading}
            className="scroll-px-8 pb-3"
            items={renderItems}
            getKey={(entry, i) => (isErrorSentinel(entry) ? `error-sentinel-${i}` : entry.id)}
            estimateItemWidth={isBackdrop ? 320 : 200}
            onRangeChange={handleRange}
            renderItem={(entry) =>
              isErrorSentinel(entry) ? (
                error ? (
                  <RowErrorInlineCard
                    error={error}
                    onRetry={() => fetchNextPage()}
                    isRetrying={isFetchingNextPage}
                  />
                ) : null
              ) : (
                <Card
                  item={entry}
                  rowKind={row.kind}
                  onWatchlistToggle={onWatchlistToggle}
                  onClick={onCardClick}
                />
              )
            }
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
