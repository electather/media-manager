import { memo, useCallback, useMemo, useRef, type CSSProperties } from "react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import {
  ScrollRow,
  ScrollRowNextButton,
  ScrollRowPrevButton,
  ScrollRowSkeleton,
  ScrollRowTrack,
  ScrollRowViewport,
} from "@/shared/components/scroll-row";
import { Card } from "../card/index";
import { useHomeRow } from "../../hooks/use-home-row";
import { ROW_COPY } from "../../lib/home-feed-config";
import type { HomeMediaItem, MessageKey, RowData } from "../../lib/types";
import { RowError, RowErrorInlineCard } from "./row-error";

const SKELETON_COUNT = 5;
const PREFETCH_OFFSET = 4;

interface RowProps {
  row: RowData;
  onWatchlistToggle?: (item: HomeMediaItem) => void;
  onCardClick?: (id: string) => void;
}

interface CardWidthVars extends CSSProperties {
  "--card-w": string;
  "--card-h": string;
}

const BACKDROP_VARS: CardWidthVars = { "--card-w": "320px", "--card-h": "180px" };
const POSTER_VARS: CardWidthVars = { "--card-w": "200px", "--card-h": "300px" };

const ERROR_SENTINEL = { __kind: "error-sentinel" as const };
type ErrorSentinel = typeof ERROR_SENTINEL;
type TrackEntry = HomeMediaItem | ErrorSentinel;

function isErrorSentinel(entry: TrackEntry): entry is ErrorSentinel {
  return (entry as ErrorSentinel).__kind === "error-sentinel";
}

/**
 * Server-driven home-feed row. Composes the shared `ScrollRow` slots
 * around items fetched via `useHomeRow`. Range-based prefetch + error /
 * skeleton states are owned here; layout primitives live in
 * `shared/components/scroll-row`.
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

  const {
    items,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isFetchingNextPage,
    error,
    refetch,
    isRefetching,
  } = useHomeRow(row.id, row.initialCursor);

  const showInitialError = error !== null && items.length === 0;
  const showInlineError = error !== null && items.length > 0;
  const showSkeletons = !showInitialError && isLoading && items.length === 0;

  const renderItems = useMemo<TrackEntry[]>(
    () => (showInlineError ? [...items, ERROR_SENTINEL] : [...items]),
    [items, showInlineError],
  );

  const handleRange = useCallback(
    ({ endIndex }: { startIndex: number; endIndex: number }) => {
      if (items.length === 0) return;
      if (!hasNextPage || isFetchingNextPage) return;
      if (endIndex >= items.length - PREFETCH_OFFSET) fetchNextPage();
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
