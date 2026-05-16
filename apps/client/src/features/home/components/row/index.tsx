import { useRef, type CSSProperties } from "react";
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
  ScrollRowItem,
  ScrollRowNextButton,
  ScrollRowPrevButton,
  ScrollRowSkeleton,
  ScrollRowTrack,
  ScrollRowViewport,
} from "@/shared/components/scroll-row";
import { Card } from "../card/index";
import { useHomeRow } from "../../hooks/use-home-row";
import { ROW_COPY, ROW_EMPTY_COPY, isUserDrivenRow } from "../../lib/home-feed-config";
import type { HomeMediaItem, MessageKey, RowData } from "../../lib/types";
import { RowError, RowErrorInlineCard } from "./row-error";
import { usePrefetchObserver } from "./use-prefetch-observer";

const SKELETON_COUNT = 5;
const PREFETCH_OFFSET = 4;

interface RowProps {
  row: RowData;
  watchlist?: ReadonlySet<string>;
  onWatchlistToggle?: (id: string) => void;
  onCardClick?: (id: string) => void;
}

interface CardWidthVars extends CSSProperties {
  "--card-w": string;
  "--card-h": string;
}

const BACKDROP_VARS: CardWidthVars = { "--card-w": "320px", "--card-h": "180px" };
const POSTER_VARS: CardWidthVars = { "--card-w": "200px", "--card-h": "300px" };

/**
 * Server-driven home-feed row. Composes the shared `ScrollRow` slots
 * around items fetched via `useHomeRow`. Prefetch wiring + error /
 * skeleton states are owned here; layout primitives live in
 * `shared/components/scroll-row`.
 */
// fallow-ignore-next-line complexity
export function Row({ row, watchlist, onWatchlistToggle, onCardClick }: RowProps) {
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
    partial,
  } = useHomeRow(row.id, row.initialCursor);
  const { attachTrack, attachPrefetch } = usePrefetchObserver({ hasNextPage, fetchNextPage });

  const showInitialError = error !== null && items.length === 0;
  const showInlineError = error !== null && items.length > 0;
  const showSkeletons = !showInitialError && isLoading && items.length === 0;
  // `partial: true` with zero items means a soft plugin failure, not an
  // empty feed. Skip the hide/empty-state path in that case so an
  // algorithmic row does not disappear and a user-driven row does not
  // show a misleading "add something" nudge.
  const showEmpty =
    !showInitialError && !isLoading && error === null && items.length === 0 && !partial;
  const prefetchIndex = items.length === 0 ? -1 : Math.max(0, items.length - PREFETCH_OFFSET);

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

  if (showEmpty) {
    if (!isUserDrivenRow(row.kind)) return null;
    const emptyFn = m[ROW_EMPTY_COPY[row.kind]] as () => string;
    return (
      <ScrollRow revalidationKey={0} className="mb-8">
        <SectionHead>
          <SectionHeadHeading>
            {eyebrow ? <SectionHeadEyebrow>{eyebrow}</SectionHeadEyebrow> : null}
            <SectionHeadTitle>{heading}</SectionHeadTitle>
          </SectionHeadHeading>
        </SectionHead>
        <ScrollRowViewport data-testid="row-scroller-bleed" style={cardVars}>
          <ScrollRowTrack aria-label={heading} className="scroll-px-8 pb-3">
            <li
              role="status"
              data-slot="scroll-row-empty"
              className="text-muted-foreground flex min-h-(--card-h) w-full items-center px-2 text-sm"
            >
              {emptyFn()}
            </li>
          </ScrollRowTrack>
        </ScrollRowViewport>
      </ScrollRow>
    );
  }

  return (
    <ScrollRow viewportRef={attachTrack} revalidationKey={items.length} className="mb-8">
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
        <ScrollRowTrack aria-label={heading} className="scroll-px-8 pb-3">
          {showSkeletons
            ? Array.from({ length: SKELETON_COUNT }, (_, i) => (
                <ScrollRowSkeleton key={`skeleton-${i}`} aspect={aspect} />
              ))
            : items.map((item, index) => (
                <ScrollRowItem
                  key={item.id}
                  data-id={item.id}
                  ref={index === prefetchIndex ? attachPrefetch : undefined}
                >
                  <Card
                    item={item as HomeMediaItem}
                    rowKind={row.kind}
                    isInWatchlist={watchlist?.has(item.id) ?? false}
                    onWatchlistToggle={onWatchlistToggle}
                    onClick={onCardClick}
                  />
                </ScrollRowItem>
              ))}
          {showInlineError ? (
            <RowErrorInlineCard
              error={error}
              onRetry={() => fetchNextPage()}
              isRetrying={isFetchingNextPage}
            />
          ) : null}
        </ScrollRowTrack>
      </ScrollRowViewport>
    </ScrollRow>
  );
}
