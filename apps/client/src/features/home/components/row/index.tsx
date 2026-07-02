import { memo, useRef } from "react";
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
import { PaginationSlot } from "@/shared/components/virtualized";
import { resolveRowCopy } from "../../lib/row-copy";
import type { HomeMediaItem, RowData } from "../../lib/types";
import { useRowData } from "../../hooks/use-row-data";
import { RowError } from "./row-error";
import { RowItemTrack, RowSkeletonTrack } from "./row-track";

interface RowProps {
  row: RowData;
  onWatchlistToggle?: (item: HomeMediaItem) => void;
  onCardClick?: (id: string) => void;
}

/**
 * Single home-feed row: lazy infinite scroll. Data lifecycle is encapsulated
 * in `useRowData`; this component owns layout and status routing only.
 * Pagination errors surface via `PaginationSlot` as a trailing card slot (#888).
 */
function RowImpl({ row, onWatchlistToggle, onCardClick }: RowProps) {
  const scopeRef = useRef<HTMLDivElement | null>(null);

  const isBackdrop = row.defaultAspect === "16/9";
  const cardVars = isBackdrop ? BACKDROP_VARS : POSTER_VARS;
  const aspect = isBackdrop ? ("16/9" as const) : ("2/3" as const);

  const { heading, eyebrow, prevLabel, nextLabel } = resolveRowCopy(row);
  const { items, status, error, isRefetching, slot, refetch, handleRange } = useRowData(row);

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

  // A resolved-but-empty row renders nothing — no heading, no reserved track height.
  if (status === "empty") return null;

  return (
    <ScrollRow revalidationKey={`${items.length}:${slot.state}`} className="mb-8">
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
            items={items}
            isBackdrop={isBackdrop}
            rowKind={row.kind}
            trailingSlot={
              slot.state === "none" ? undefined : <PaginationSlot slot={slot} variant="card" />
            }
            onRangeChange={handleRange}
            onWatchlistToggle={onWatchlistToggle}
            onCardClick={onCardClick}
          />
        )}
      </ScrollRowViewport>
    </ScrollRow>
  );
}

/**
 * Memoised so re-renders of `HomeFeedReady` don't cascade into every visible
 * row. Membership lookup lives inside `<Card>` via `useIsInWatchlist`, so Row
 * no longer needs the full watchlist set on its prop surface.
 */
export const Row = memo(RowImpl);
