import { memo, useRef } from "react";
import { resolveRowCopy } from "../../lib/row-copy";
import type { HomeMediaItem, RowData } from "../../lib/types";
import { useRowData } from "../../hooks/use-row-data";
import { RowError } from "./row-error";
import { RowItemTrack, RowScrollContainer, RowSkeletonTrack } from "./row-track";

interface RowProps {
  row: RowData;
  onWatchlistToggle?: (item: HomeMediaItem) => void;
  onCardClick?: (id: string) => void;
}

/**
 * Single home-feed row: lazy infinite scroll. Data lifecycle is in `useRowData`;
 * this component owns status routing only. Pagination errors surface via
 * `PaginationSlot` as a trailing card slot (#888).
 */
function RowImpl({ row, onWatchlistToggle, onCardClick }: RowProps) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const { heading, eyebrow, prevLabel, nextLabel } = resolveRowCopy(row);
  const {
    items,
    status,
    aspect,
    isBackdrop,
    cardVars,
    error,
    isRefetching,
    slot,
    trailingSlot,
    refetch,
    handleRange,
  } = useRowData(row);

  // rowStatus returns "initial-error" only when error != null, so the cast is safe
  if (status === "initial-error") {
    return (
      <div
        ref={scopeRef}
        className="row-track-scope"
        data-testid="row-scroller-bleed"
        style={cardVars}
      >
        <RowError error={error!} onRetry={refetch} isRetrying={isRefetching} />
      </div>
    );
  }

  if (status === "empty") return null;

  return (
    <RowScrollContainer
      heading={heading}
      eyebrow={eyebrow}
      prevLabel={prevLabel}
      nextLabel={nextLabel}
      revalidationKey={`${items.length}:${slot.state}`}
      cardVars={cardVars}
    >
      {status === "skeletons" ? (
        <RowSkeletonTrack heading={heading} aspect={aspect} />
      ) : (
        <RowItemTrack
          heading={heading}
          items={items}
          isBackdrop={isBackdrop}
          rowKind={row.kind}
          trailingSlot={trailingSlot}
          onRangeChange={handleRange}
          onWatchlistToggle={onWatchlistToggle}
          onCardClick={onCardClick}
        />
      )}
    </RowScrollContainer>
  );
}

/**
 * Memoised so re-renders of `HomeFeedReady` don't cascade into every visible
 * row. Membership lookup lives inside `<Card>` via `useIsInWatchlist`.
 */
export const Row = memo(RowImpl);
